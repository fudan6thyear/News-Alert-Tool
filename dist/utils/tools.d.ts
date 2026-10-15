import type { ServerResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
export type Results = Record<string, string | number | undefined | null>[];
export type ToolConfig = {
    name: string;
    description: string;
    zodSchema?: z.ZodSchema<unknown>;
    func: (args: unknown) => Promise<Results>;
};
type MaybePromise<T> = T | Promise<T>;
export declare const defineToolConfig: (config: ToolConfig | (() => MaybePromise<ToolConfig | ToolConfig[]>)) => Promise<ToolConfig | ToolConfig[]>;
export declare function loadToolConfigs(toolsContext: Rspack.Context): Promise<Map<string, ToolConfig>>;
export declare const handleErrorResult: (error: unknown) => ServerResult;
export declare const handleSuccessResult: (results: Results, toolName: string) => ServerResult;
export {};
