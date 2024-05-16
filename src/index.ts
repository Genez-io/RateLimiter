/* eslint-disable*/
import Redis from "ioredis";
import { GenezioError, GenezioErrorCodes } from "@genezio/types";

/**  *
 * The type that defines the parameters of the GenezioRateLimiter decorator.
 * @param {string} dbUrl The URL of the Redis database (default is redis://localhost:6379).
 * @param {number} limit The maximum number of requests that can be made from the same sourceIp in a minute (default is 50).
 * @param {number} refreshRate The rate at which the limit is refreshed in seconds (default is 59).
 */
export type GenezioRateLimiterOptionsParameters = {
    dbUrl?: string;
    limit?: number;
    refreshRate?: number;
};

/**
 * Decorator that marks that limits the number of requests being made from the same sourceIp.
 * @param {GenezioRateLimiterOptionsParameters} _dict An object that contains the parameters of the GenezioRateLimiter.
 * The object has the following structure: {dbUrl?: string, limit?: number, refreshRate?: number}
 * @returns the async function that will be executed after the rate limiter is applied.
 */
export function GenezioRateLimiter(_dict: GenezioRateLimiterOptionsParameters = {}) {
    let redisClient: Redis;
    // Connect to the Redis database
    try {
        let retryCount = 0;
        redisClient = new Redis(_dict.dbUrl ? _dict.dbUrl : "redis://localhost:6379", {
            retryStrategy: function () {
                if (retryCount > 5) {
                    return undefined;
                }
                return 1000;
            },
        });
        redisClient.on("error", function (error) {
            console.log("Could not connect to the Redis database. " + error);
            retryCount++;
            if (retryCount > 5) {
                console.log(
                    "Could not connect to the Redis database after 5 retries. Stopping polling."
                );
                redisClient.disconnect();
                throw error;
            }
        });
        redisClient.on("reconnecting", function () {
            console.log("Trying to reconnect to the Redis database...");
        });
    } catch (error) {
        console.log(
            "Error when operating on the redis client. Remember to set the Redis dbUrl parameter in the GenezioRateLimiter decorator."
        );
        throw error;
    }
    return function (value: Function, _context: any) {
        return async function (...args: any[]) {
            // Check if the first parameter is a GnzContext object
            if (args.length === 0 || !args[0].isGnzContext) {
                console.log(
                    "Error: the GenezioRateLimiter decorator must be used with the first parameter being a GnzContext object"
                );
                throw new GenezioError(
                    "Error: the GenezioRateLimiter decorator must be used with the first parameter being a GnzContext object",
                    GenezioErrorCodes.BadRequest
                );
            }

            try {
                const date = new Date();
                const oldCount = await redisClient.get(
                    `${args[0].requestContext.http.sourceIp}:${_context.name}:${date.getMinutes()}`
                );
                // If the limit is reached, throw an error
                if (oldCount && parseInt(oldCount) >= (_dict.limit ? _dict.limit : 50)) {
                    throw new GenezioError("Rate limit exceeded", GenezioErrorCodes.RequestTimeout);
                }
                // If the refresh rate is less than 1 second, throw an error
                if (_dict.refreshRate && _dict.refreshRate < 1) {
                    throw new GenezioError(
                        "The refresh rate must be at least 1 second",
                        GenezioErrorCodes.BadRequest
                    );
                }
                // Increment the count of requests made by the sourceIp in the current minute
                await redisClient
                    .multi()
                    .incr(
                        `${args[0].requestContext.http.sourceIp}:${
                            _context.name
                        }:${date.getMinutes()}`
                    )
                    .expire(
                        `${args[0].requestContext.http.sourceIp}:${
                            _context.name
                        }:${date.getMinutes()}`,
                        _dict.refreshRate ? _dict.refreshRate : 59
                    )
                    .exec();
            } catch (error) {
                // If the error is a RequestTimeout error, throw it to indicate that the request should be timed out
                if ((error as GenezioError).code !== GenezioErrorCodes.RequestTimeout) {
                    console.log(
                        "Error when operating on the redis client. Remember to set the Redis dbUrl parameter in the GenezioRateLimiter decorator."
                    );
                }
                throw error;
            }

            // @ts-expect-error
            const func = value.bind(this);
            const result = func(...args);
            return result;
        };
    };
}
