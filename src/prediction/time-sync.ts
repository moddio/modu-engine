/**
 * Time Synchronization for Client-Side Prediction
 *
 * Uses a hybrid approach:
 * - NetStorm algorithm for initial synchronization
 * - Unity-style gradual drift correction for ongoing sync
 *
 * References:
 * - http://www.mine-control.com/zack/timesync/timesync.html (NetStorm)
 * - https://docs.unity3d.com/Packages/com.unity.netcode@0.0/manual/time-synchronization.html
 */

import { TimeSyncSample, TimeSyncStats } from './types';

/**
 * Number of samples to collect during initial sync.
 */
const INITIAL_SYNC_SAMPLES = 8;

/**
 * Minimum samples needed before computing filtered average.
 */
const MIN_SAMPLES_FOR_FILTER = 5;

/**
 * Maximum tick rate adjustment (±5%).
 */
const MAX_TICK_RATE_ADJUSTMENT = 0.05;

/**
 * Smoothing factor for drift correction (0.1 = 10% weight on new measurement).
 */
const DRIFT_SMOOTHING_FACTOR = 0.1;

/**
 * TimeSyncManager handles clock synchronization between client and server.
 *
 * The synchronization process:
 * 1. Client sends INPUT with syncTimestamp = Date.now()
 * 2. Server echoes syncTimestamp back in TICK along with serverTimestamp
 * 3. Client calculates:
 *    - latency = (receiveTime - sentTime) / 2
 *    - clockDelta = serverTime - receiveTime + latency
 * 4. First sample is used immediately to get in "right ballpark"
 * 5. After MIN_SAMPLES_FOR_FILTER samples, NetStorm filtering is applied
 * 6. Ongoing drift is corrected by adjusting local tick rate
 */
export class TimeSyncManager {
    /** Estimated clock delta (add to local time to get server time) */
    private clockDelta: number = 0;

    /** Collected sync samples */
    private samples: TimeSyncSample[] = [];

    /** Whether initial sync is complete */
    private synced: boolean = false;

    /** Tick rate multiplier for drift correction (1.0 = normal speed) */
    private tickRateMultiplier: number = 1.0;

    /** Last tick arrival time (for drift detection) */
    private lastTickArrival: number = 0;

    /** Estimated latency (ms) */
    private estimatedLatency: number = 0;

    /** Server start time (from first INITIAL_STATE) */
    private serverStartTime: number = 0;

    /**
     * Process a time sync response from the server.
     *
     * @param sentTime - When the client sent the sync request (local time)
     * @param serverTime - Server's timestamp when it processed the request
     * @param receiveTime - When the client received the response (local time)
     */
    onTimeResponse(sentTime: number, serverTime: number, receiveTime: number): void {
        const rtt = receiveTime - sentTime;
        const latency = rtt / 2;
        const delta = serverTime - receiveTime + latency;

        // First sample: use immediately to get in ballpark
        if (!this.synced) {
            this.clockDelta = delta;
            this.synced = true;
            this.estimatedLatency = latency;
        }

        this.samples.push({
            latency,
            delta,
            timestamp: receiveTime
        });

        // After enough samples, compute filtered average
        if (this.samples.length >= MIN_SAMPLES_FOR_FILTER) {
            this.clockDelta = this.computeFilteredDelta();
            this.estimatedLatency = this.computeFilteredLatency();
        }
    }

    /**
     * Compute filtered clock delta using NetStorm algorithm.
     *
     * The algorithm:
     * 1. Sort samples by latency (lowest first)
     * 2. Find median latency
     * 3. Compute standard deviation
     * 4. Filter out samples with latency > median + stdDev (eliminates outliers)
     * 5. Average remaining samples' deltas
     */
    private computeFilteredDelta(): number {
        if (this.samples.length === 0) return this.clockDelta;

        // Sort by latency (ascending)
        const sorted = [...this.samples].sort((a, b) => a.latency - b.latency);

        // Find median latency
        const medianIdx = Math.floor(sorted.length / 2);
        const medianLatency = sorted[medianIdx].latency;

        // Compute mean and standard deviation of latencies
        const mean = sorted.reduce((sum, s) => sum + s.latency, 0) / sorted.length;
        const variance = sorted.reduce((sum, s) => sum + (s.latency - mean) ** 2, 0) / sorted.length;
        const stdDev = Math.sqrt(variance);

        // Filter: keep samples within 1 stdDev of median
        // This eliminates TCP retransmission spikes
        const filtered = sorted.filter(s => s.latency <= medianLatency + stdDev);

        if (filtered.length === 0) {
            // All samples filtered out - use median sample
            return sorted[medianIdx].delta;
        }

        // Average the deltas from filtered samples
        return filtered.reduce((sum, s) => sum + s.delta, 0) / filtered.length;
    }

    /**
     * Compute filtered latency estimate.
     */
    private computeFilteredLatency(): number {
        if (this.samples.length === 0) return this.estimatedLatency;

        const sorted = [...this.samples].sort((a, b) => a.latency - b.latency);
        const medianIdx = Math.floor(sorted.length / 2);
        const medianLatency = sorted[medianIdx].latency;

        const mean = sorted.reduce((sum, s) => sum + s.latency, 0) / sorted.length;
        const variance = sorted.reduce((sum, s) => sum + (s.latency - mean) ** 2, 0) / sorted.length;
        const stdDev = Math.sqrt(variance);

        const filtered = sorted.filter(s => s.latency <= medianLatency + stdDev);
        if (filtered.length === 0) return medianLatency;

        return filtered.reduce((sum, s) => sum + s.latency, 0) / filtered.length;
    }

    /**
     * Called when a TICK is received for drift correction.
     *
     * Unity-style drift correction:
     * - Track tick arrival intervals vs expected
     * - Adjust local tick rate by small amounts (±5% max)
     * - This smoothly corrects drift without time jumps
     *
     * @param expectedInterval - Expected time between ticks (e.g., 50ms for 20Hz)
     */
    onTickReceived(expectedInterval: number): void {
        const now = performance.now();

        if (this.lastTickArrival > 0) {
            const actualInterval = now - this.lastTickArrival;
            const drift = actualInterval - expectedInterval;

            // Calculate adjustment: if ticks arriving faster than expected,
            // we need to slow down our local tick rate (multiplier > 1)
            const rawAdjustment = (drift / expectedInterval) * DRIFT_SMOOTHING_FACTOR;

            // Clamp to max adjustment
            const clampedAdjustment = Math.max(
                -MAX_TICK_RATE_ADJUSTMENT,
                Math.min(MAX_TICK_RATE_ADJUSTMENT, rawAdjustment)
            );

            // Smoothly update multiplier
            // If drift is positive (ticks late), we speed up (multiplier < 1)
            // If drift is negative (ticks early), we slow down (multiplier > 1)
            this.tickRateMultiplier = 1.0 - clampedAdjustment;
        }

        this.lastTickArrival = now;
    }

    /**
     * Get current server time estimate.
     */
    getServerTime(): number {
        return Date.now() + this.clockDelta;
    }

    /**
     * Get the target frame based on server time.
     *
     * @param tickInterval - Time per tick in ms (e.g., 50 for 20Hz)
     * @param serverStartTime - Server's start time (from INITIAL_STATE)
     */
    getTargetFrame(tickInterval: number, serverStartTime?: number): number {
        const startTime = serverStartTime ?? this.serverStartTime;
        if (!startTime) return 0;

        const serverTime = this.getServerTime();
        return Math.floor((serverTime - startTime) / tickInterval);
    }

    /**
     * Get tick rate multiplier for drift correction.
     * Values > 1 mean run faster, < 1 mean run slower.
     */
    getTickRateMultiplier(): number {
        return this.tickRateMultiplier;
    }

    /**
     * Check if initial sync is complete.
     */
    isSynced(): boolean {
        return this.synced;
    }

    /**
     * Get the clock delta (add to local time to get server time).
     */
    getClockDelta(): number {
        return this.clockDelta;
    }

    /**
     * Get estimated latency in ms.
     */
    getEstimatedLatency(): number {
        return this.estimatedLatency;
    }

    /**
     * Set server start time (from INITIAL_STATE).
     */
    setServerStartTime(time: number): void {
        this.serverStartTime = time;
    }

    /**
     * Get server start time.
     */
    getServerStartTime(): number {
        return this.serverStartTime;
    }

    /**
     * Clear samples for a fresh sync (e.g., periodic re-sync).
     */
    clearSamples(): void {
        this.samples = [];
    }

    /**
     * Get number of samples collected.
     */
    getSampleCount(): number {
        return this.samples.length;
    }

    /**
     * Check if we need more sync samples.
     */
    needsMoreSamples(): boolean {
        return this.samples.length < INITIAL_SYNC_SAMPLES;
    }

    /**
     * Get stats for debugging.
     */
    getStats(): TimeSyncStats {
        return {
            clockDelta: this.clockDelta,
            synced: this.synced,
            sampleCount: this.samples.length,
            tickRateMultiplier: this.tickRateMultiplier,
            estimatedLatency: this.estimatedLatency
        };
    }

    /**
     * Reset all state.
     */
    reset(): void {
        this.clockDelta = 0;
        this.samples = [];
        this.synced = false;
        this.tickRateMultiplier = 1.0;
        this.lastTickArrival = 0;
        this.estimatedLatency = 0;
        this.serverStartTime = 0;
    }
}
