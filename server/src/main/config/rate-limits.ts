import {env} from './env.js';
import type {BucketConfig} from '../../data/protocols/rate-limit/rate-limiter.js';

export const RATE_LIMITS = {
  audit: {capacity: env.auditRateCapacity, refillPerHour: env.auditRatePerHour},
  auditRead: {capacity: 60, refillPerHour: 600},
  login: {capacity: 10, refillPerHour: 30},
  loginEmail: {capacity: 5, refillPerHour: 10},
  signup: {capacity: 3, refillPerHour: 5},
  logout: {capacity: 30, refillPerHour: 120},
  me: {capacity: 60, refillPerHour: 600},
  pageAdd: {capacity: 10, refillPerHour: 20},
  pageUpdate: {capacity: 30, refillPerHour: 120},
  pageDelete: {capacity: 30, refillPerHour: 120},
  pageRead: {capacity: 60, refillPerHour: 600},
  pageHistory: {capacity: 60, refillPerHour: 600},
  pageAudit: {capacity: 30, refillPerHour: 120},
  alertUnsubscribe: {capacity: 10, refillPerHour: 30},
  alertUnsubscribeRead: {capacity: 30, refillPerHour: 120},
} as const satisfies Record<string, BucketConfig>;
