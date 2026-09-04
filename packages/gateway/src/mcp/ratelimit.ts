export class RateLimiter {
  private timestamps: number[] = [];

  constructor(
    private maxRequests: number = 120,
    private windowMs: number = 60000,
  ) {}

  checkLimit(): boolean {
    const now = Date.now();
    const windowStart = now - this.windowMs;

    this.timestamps = this.timestamps.filter((t) => t > windowStart);

    if (this.timestamps.length >= this.maxRequests) {
      return false;
    }

    this.timestamps.push(now);
    return true;
  }

  isAllowed(sessionId?: string): boolean {
    return this.checkLimit();
  }

  reset(): void {
    this.timestamps = [];
  }
}
