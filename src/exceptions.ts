
// transated from: https://github.com/philipkocanda/juicebox-protocol

// Define a base exception for Juicebox-related errors
class JuiceboxException extends Error {
    constructor(message: string) {
        super(message);
        this.name = "JuiceboxException";
    }
}

// Specific exception for invalid message formats
class InvalidMessageFormat extends JuiceboxException {
    constructor(message: string) {
        super(message);
        this.name = "InvalidMessageFormat";
    }
}

// Specific exception for checksum errors
class JuiceboxChecksumError extends JuiceboxException {
    constructor(message: string) {
        super(message);
        this.name = "JuiceboxChecksumError";
    }
}

export { JuiceboxException, InvalidMessageFormat, JuiceboxChecksumError };