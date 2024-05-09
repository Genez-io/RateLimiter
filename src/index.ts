import Redis from "ioredis";
import { GenezioError, GenezioErrorCodes } from "@genezio/types";

/**  *
 * The type that defines the parameters of the GenezioRateLimiter decorator.
 * @param {string} dbUrl The URL of the Redis database.
 * @param {number} limit The maximum number of requests that can be made from the same sourceIp in a minute.
 *
 */
export type GenezioRateLimiterOptionsParameters = { dbUrl?: string; limit?: number };

/**
 * Decorator that marks that limits the number of requests being made from the same sourceIp.
 * @param {GenezioRateLimiterOptionsParameters} _dict An object that contains the parameters of the GenezioRateLimiter.
 * The object has the following structure: {dbUrl?: string, limit?: number}
 * @returns the async function that will be executed after the rate limiter is applied.
 */
export function GenezioRateLimiter(_dict: GenezioRateLimiterOptionsParameters = {}) {
    let redisClient: Redis;
    // Connect to the Redis database
    try {
        redisClient = new Redis(_dict.dbUrl ? _dict.dbUrl : "", {
            retryStrategy: function () {
                return undefined;
            },
        });
    } catch (error) {
        console.log(
            "Error when opperating on the redis client. Remember to set the Redis dbUrl parameter in the RateLimiter decorator."
        );
        console.log(error);
    }
    return function (value: Function, _context: any) {
        return async function (...args: any[]) {
            // Check if the first parameter is a GnzContext object
            if (args.length === 0 || !args[0].isGnzContext) {
                console.log(
                    "Warning: the GenezioRateLimiter decorator must be used with the first parameter being a GnzContext object"
                );
            } else {
                try {
                    const date = new Date();
                    const oldCount = await redisClient.get(
                        `${args[0].requestContext.http.sourceIp}:${date.getMinutes()}`
                    );
                    // If the limit is reached, throw an error
                    if (oldCount && parseInt(oldCount) >= (_dict.limit ? _dict.limit : 50)) {
                        throw new GenezioError(
                            "Rate limit exceeded",
                            GenezioErrorCodes.RequestTimeout
                        );
                    }
                    // Increment the count of requests made by the sourceIp in the current minute
                    await redisClient
                        .multi()
                        .incr(`${args[0].requestContext.http.sourceIp}:${date.getMinutes()}`)
                        .expire(`${args[0].requestContext.http.sourceIp}:${date.getMinutes()}`, 59)
                        .exec();
                } catch (error) {
                    // If the error is a RequestTimeout error, throw it to indicate that the request should be timed out
                    if ((error as GenezioError).code === GenezioErrorCodes.RequestTimeout) {
                        throw error;
                    }
                    console.log(
                        "Error when opperating on the redis client. Remember to set the Redis dbUrl parameter in the GenezioRateLimiter decorator."
                    );
                    console.log(error);
                }
            }

            // @ts-expect-error
            const func = value.bind(this);
            const result = func(...args);
            return result;
        };
    };
}
