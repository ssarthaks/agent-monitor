import { EventEmitter } from 'node:events';
import { AgentEvent } from '@agent-monitor/core';

export type EventCallback = (event: AgentEvent) => void;

export class EventBus {
  private emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(100);
  }

  publish(event: AgentEvent): void {
    this.emitter.emit(`session:${event.sessionId}`, event);
    this.emitter.emit('event', event);
  }

  subscribe(sessionId: string, callback: EventCallback): () => void {
    const channel = `session:${sessionId}`;
    this.emitter.on(channel, callback);
    return () => {
      this.emitter.off(channel, callback);
    };
  }

  subscribeAll(callback: EventCallback): () => void {
    this.emitter.on('event', callback);
    return () => {
      this.emitter.off('event', callback);
    };
  }
}
