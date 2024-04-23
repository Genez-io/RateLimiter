import Redis from "ioredis";
import { GenezioError, GenezioErrorCodes } from "@genezio/types";

export type GenezioRateLimiterOptionsParameters = { dbUrl?: string; limit?: number };

// Decorator that marks that limits the number of requests being made from the same sourceIp.
export function GenezioRateLimiter(_dict: GenezioRateLimiterOptionsParameters = {}) {
    let redisClient: Redis;
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
                    if (oldCount && parseInt(oldCount) >= (_dict.limit ? _dict.limit : 50)) {
                        throw new GenezioError(
                            "Rate limit exceeded",
                            GenezioErrorCodes.RequestTimeout
                        );
                    }
                    await redisClient
                        .multi()
                        .incr(`${args[0].requestContext.http.sourceIp}:${date.getMinutes()}`)
                        .expire(`${args[0].requestContext.http.sourceIp}:${date.getMinutes()}`, 59)
                        .exec();
                } catch (error) {
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
