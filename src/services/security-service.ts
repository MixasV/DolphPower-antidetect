import * as crypto from 'crypto';

export interface PendingConfirmation {
    id: string;
    action: string;
    chatId: string;
    pin: string;
    expiresAt: number;
    args: any;
}

export class SecurityService {
    private pendingConfirmations: Map<string, PendingConfirmation> = new Map();
    private readonly PIN_EXPIRY = 5 * 60 * 1000; // 5 minutes

    /**
     * Generates a random 6-digit PIN and stores the pending action.
     */
    createPendingAction(action: string, chatId: string, args: any): PendingConfirmation {
        const id = crypto.randomBytes(8).toString('hex');
        const pin = Math.floor(100000 + Math.random() * 900000).toString();
        
        const confirmation: PendingConfirmation = {
            id,
            action,
            chatId,
            pin,
            args,
            expiresAt: Date.now() + this.PIN_EXPIRY
        };

        this.pendingConfirmations.set(id, confirmation);
        
        // Auto-cleanup after expiry
        setTimeout(() => this.pendingConfirmations.delete(id), this.PIN_EXPIRY + 1000);

        return confirmation;
    }

    getPendingActionByPin(pin: string): PendingConfirmation | undefined {
        const now = Date.now();
        for (const [id, conf] of this.pendingConfirmations.entries()) {
            if (conf.pin === pin && conf.expiresAt > now) {
                return conf;
            }
        }
        return undefined;
    }

    resolveAction(id: string) {
        this.pendingConfirmations.delete(id);
    }

    getAllPending(): PendingConfirmation[] {
        const now = Date.now();
        return Array.from(this.pendingConfirmations.values()).filter(c => c.expiresAt > now);
    }
}
