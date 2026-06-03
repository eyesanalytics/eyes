import type { EyesConfig, EyesContract, IdentifyTraits } from 'eyes-types';

declare global {
    interface Window {
        Eyes?: {
            init(config: EyesConfig): EyesContract;
            track(name: string, props?: Record<string, string | number | boolean>): void;
            page(props?: Record<string, string | number | boolean>): void;
            flush(): Promise<void>;
            shutdown(): Promise<void>;
            consent(): void;
            revokeConsent(): void;
            identify(traits: IdentifyTraits): void;
        };
    }
}
