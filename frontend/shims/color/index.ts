// The part of the `color` package PatchComponent uses: Color(value).hsl().string().
class HslColor {
  constructor(private readonly h: number, private readonly s: number, private readonly l: number, private readonly a: number) {}

  hsl() {
    return this;
  }

  array(): number[] {
    return this.a === 1 ? [this.h, this.s, this.l] : [this.h, this.s, this.l, this.a];
  }

  string(): string {
    const [h, s, l] = [this.h, this.s, this.l].map((value) => Number(value.toFixed(1)));
    return this.a === 1 ? `hsl(${h}, ${s}%, ${l}%)` : `hsla(${h}, ${s}%, ${l}%, ${this.a})`;
  }
}

const fromRgb = (r: number, g: number, b: number, a: number) => {
  const [red, green, blue] = [r / 255, g / 255, b / 255];
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const delta = max - min;
  const l = (max + min) / 2;
  const s = delta === 0 ? 0 : delta / (1 - Math.abs(2 * l - 1));
  let h = 0;
  if (delta !== 0) {
    if (max === red) h = ((green - blue) / delta) % 6;
    else if (max === green) h = (blue - red) / delta + 2;
    else h = (red - green) / delta + 4;
    h = (h * 60 + 360) % 360;
  }
  return new HslColor(h, s * 100, l * 100, a);
};

export default function Color(value: string): HslColor {
  const text = String(value).trim();
  const hex = /^#([0-9a-f]{3,8})$/i.exec(text)?.[1];
  if (hex && [3, 4, 6, 8].includes(hex.length)) {
    const full = hex.length <= 4 ? [...hex].map((char) => char + char).join('') : hex;
    const channel = (index: number) => parseInt(full.slice(index, index + 2), 16);
    return fromRgb(channel(0), channel(2), channel(4), full.length === 8 ? channel(6) / 255 : 1);
  }
  const parts = /^(rgb|hsl)a?\(([^)]*)\)$/i.exec(text);
  if (parts) {
    const numbers = parts[2].split(/[\s,/]+/).filter(Boolean).map((part) => parseFloat(part));
    const alpha = numbers[3] ?? 1;
    if (numbers.length >= 3 && numbers.every((number) => !Number.isNaN(number))) {
      return parts[1].toLowerCase() === 'rgb'
        ? fromRgb(numbers[0], numbers[1], numbers[2], alpha)
        : new HslColor(numbers[0], numbers[1], numbers[2], alpha);
    }
  }
  throw new Error(`Unable to parse color from string: ${value}`);
}
