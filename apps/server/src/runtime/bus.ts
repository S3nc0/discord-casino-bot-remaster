import { EventEmitter } from 'node:events';
import type { BalanceUpdate, DomainEvent, DomainEventMap, DomainEventType } from '@casino/shared';

type Listener<T> = (event: T) => void;

/**
 * In-process bus. Services publish after their transaction commits; subscribers (socket rooms,
 * announcer, inbox, ...) never run inside a transaction. A throwing subscriber is reported to
 * `onError` and does not stop the others or reach the publisher.
 */
export class EventBus {
  private readonly emitter = new EventEmitter();
  private readonly onError: (error: unknown, channel: string) => void;

  constructor(onError: (error: unknown, channel: string) => void = () => {}) {
    this.emitter.setMaxListeners(0);
    this.onError = onError;
  }

  publishDomain(event: DomainEvent): void {
    this.dispatch(event.type, event);
    this.dispatch('domain:*', event);
  }

  /** Subscribe to one event type. Returns an unsubscribe function. */
  onDomain<T extends DomainEventType>(type: T, listener: Listener<DomainEventMap[T]>): () => void {
    return this.subscribe(type, listener as Listener<unknown>);
  }

  /** Subscribe to every domain event. */
  onAnyDomain(listener: Listener<DomainEvent>): () => void {
    return this.subscribe('domain:*', listener as Listener<unknown>);
  }

  publishBalance(update: BalanceUpdate): void {
    this.dispatch('balance', update);
  }

  onBalance(listener: Listener<BalanceUpdate>): () => void {
    return this.subscribe('balance', listener as Listener<unknown>);
  }

  private subscribe(channel: string, listener: Listener<unknown>): () => void {
    this.emitter.on(channel, listener);
    return () => {
      this.emitter.off(channel, listener);
    };
  }

  private dispatch(channel: string, payload: unknown): void {
    for (const listener of this.emitter.listeners(channel) as Listener<unknown>[]) {
      try {
        listener(payload);
      } catch (error) {
        this.onError(error, channel);
      }
    }
  }
}
