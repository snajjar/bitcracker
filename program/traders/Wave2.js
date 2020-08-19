const Trader = require('./trader');
const tulind = require('tulind');
const _ = require('lodash');
const dt = require('../lib/datatools');

class WaveTrader extends Trader {
    constructor() {
        super();

        this.waveLength = 1440 * 4;
        this.zoneTreshold = 0.04;
    }

    analysisIntervalLength() {
        return this.waveLength;
    }

    hash() {
        return "Algo_Wave2";
    }

    // decide for an action
    async action(crypto, candles, currentPrice) {
        // BUY when at the lowest of the wave
        // SELL when at the highest
        try {
            let lowest = _.minBy(candles, o => o.low).low;
            let highest = _.maxBy(candles, o => o.high).high;
            let amplitude = highest - lowest;

            let inBuyZone = currentPrice < lowest + amplitude * this.zoneTreshold;
            let inSellZone = currentPrice > lowest + amplitude * (1 - this.zoneTreshold);

            if (!this.isInTrade()) {
                if (inBuyZone) {
                    return this.buy();
                } else {
                    return this.hold();
                }
            } else {
                if (inSellZone) {
                    return this.sell();
                } else {
                    return this.hold();
                }
            }
        } catch (e) {
            console.error("Err: " + e.stack);
            process.exit(-1);
        }
    }
}

module.exports = WaveTrader;