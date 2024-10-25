// transated from: https://github.com/philipkocanda/juicebox-protocol


export class Checksum {
    static ALPHABET: string = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    payload: string;

    constructor(payload: string) {
        this.payload = payload;
    }

    integer(): number {
        return this.crc(this.payload);
    }

    base35(): string {
        return this.base35encode(this.integer());
    }

    inspect(): Record<string, any> {
        return {
            payload: this.payload,
            base35: this.base35(),
            integer: this.integer(),
        };
    }

    base35encode(number: number): string {
        let base35 = "";

        while (number > 1) {
            let i;
            [number, i] = [Math.floor(number / 35), number % 35];
            if (i === 24) {
                i = 35;
            }
            base35 = base35 + Checksum.ALPHABET[i];
        }

        return base35;
    }

    base35decode(number: string): number {
        let decimal = 0;
        Array.from(number).reverse().forEach((char, i) => {
            decimal += Checksum.ALPHABET.indexOf(char) * (35 ** i);
        });
        return decimal;
    }

    crc(data: string): number {
        let h = 0;
        for (const s of data) {
            h ^= (h << 5) + (h >> 2) + s.charCodeAt(0);
            h &= 0xFFFF;
        }
        return h;
    }
}