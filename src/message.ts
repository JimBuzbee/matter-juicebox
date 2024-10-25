
// transated from: https://github.com/philipkocanda/juicebox-protocol

import { Checksum } from './checksum.js';
import { InvalidMessageFormat } from './exceptions.js';
import moment from 'moment';

class Message {
    payload_str: string | null = null;
    checksum_str: string | null = null;

    offline_amperage = 0;
    instant_amperage = 0;
    command = 6; // Alternates between C242, C244, C008, C006
    counter = 1;
    time = moment();

    constructor() {}

    fromString(string: string): Message {
        const msg = string.match(/((?<payload>.*)!(?<checksum>[A-Z0-9]{3})(?:\$|:))/);

        if (!msg || !msg.groups) {
            throw new InvalidMessageFormat(`Unable to parse message: '${string}'`);
        }

        this.payload_str = msg.groups.payload;
        this.checksum_str = msg.groups.checksum;
        return this;
    }

    checksum(): Checksum {
        if (!this.payload_str) throw new InvalidMessageFormat('Payload is missing');
        return new Checksum(this.payload_str);
    }

    checksumComputed(): string {
        return this.checksum().base35();
    }

    buildPayload(): void {
        if (this.payload_str) return;

        const weekday = this.time.format('E'); // 1 = Monday, 7 = Sunday
        this.payload_str = `CMD${weekday}${this.time.format('HHmm')}A${this.offline_amperage.toString().padStart(2, '0')}M${this.instant_amperage.toString().padStart(2, '0')}C${this.command.toString().padStart(3, '0')}S${this.counter.toString().padStart(3, '0')}`;
        this.checksum_str = this.checksumComputed();
    }

    build(): string {
        this.buildPayload();
        return `${this.payload_str}!${this.checksum_str}$`;
    }

    inspect(): Record<string, unknown> {
        return {
            offline_amperage: this.offline_amperage,
            instant_amperage: this.instant_amperage,
            payload_str: this.payload_str,
            checksum_str: this.checksum_str,
            checksum_computed: this.checksumComputed(),
        };
    }

    toString(): string {
        return this.build();
    }
}

export { Message };