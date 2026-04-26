export function slugify(s) {
  return s.toLowerCase().replace(/\s+/g, "-");
}

function internalNormalize(s) {
  return s.trim();
}

export class StringBuilder {
  constructor() {
    this.parts = [];
  }
  push(s) {
    this.parts.push(internalNormalize(s));
  }
  build() {
    return this.parts.join("");
  }
}

export const EMPTY = "";
