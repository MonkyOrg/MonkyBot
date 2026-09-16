import * as runtime from '@monky/bot-sdk/dist/localRuntime';

export type { CaptureOptions, YouTubeProviderCause } from '@monky/bot-sdk/dist/localRuntime';
export const capture = runtime.capture;
export const captureBytes = runtime.captureBytes;
export const bounded = runtime.bounded;
export const cancellable = runtime.cancellable;
export const terminate = runtime.terminate;
export const safeDiagnostic = runtime.safeDiagnostic;
export const errorDiagnostic = runtime.errorDiagnostic;
export const youtubeProviderCause = runtime.youtubeProviderCause;
