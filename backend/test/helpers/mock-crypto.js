// crypto.randomUUID mock for testing auth.js

let counter = 0;
let original = null;

export function installCryptoMock() {
  counter = 0;
  if (typeof globalThis.crypto !== 'undefined' && typeof globalThis.crypto.randomUUID === 'function') {
    original = globalThis.crypto.randomUUID;
    globalThis.crypto.randomUUID = () => {
      counter++;
      return `test-uuid-${String(counter).padStart(3, '0')}`;
    };
  } else {
    Object.defineProperty(globalThis, 'crypto', {
      value: {
        randomUUID: () => {
          counter++;
          return `test-uuid-${String(counter).padStart(3, '0')}`;
        },
      },
      writable: true,
      configurable: true,
    });
  }
}

export function uninstallCryptoMock() {
  if (original && globalThis.crypto) {
    globalThis.crypto.randomUUID = original;
    original = null;
  }
}

export function resetCryptoCounter() {
  counter = 0;
}

export function getUuidCount() {
  return counter;
}
