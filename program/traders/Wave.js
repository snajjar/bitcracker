const Trader = require('./trader');
const tulind = require('tulind');
const _ = require('lodash');

class WaveTrader extends Trader {
    constructor() {
        super();

        // parameters
        this.emaPeriods = 2;
        this.emaTrigger = 0.4;

        this.waveLength = 700;
        this.dangerZoneRatio = 0.90;
    }

    analysisIntervalLength() {
        return this.waveLength;
    }

    hash() {
        return "Algo_Wave";
    }

    getEMA(dataPeriods) {
        let closePrices = _.map(dataPeriods, p => p.close);
        return new Promise((resolve, reject) => {
            tulind.indicators.ema.indicator([closePrices], [this.emaPeriods], function(err, results) {
                if (err) {
                    reject(err);
                } else {
                    resolve(results[0]);
                }
            });
        });
    }

    // decide for an action
    async action(crypto, candles, currentPrice) {

        // BUY when at the lowest of the wave
        // SELL when at the highest
        try {
            let lowest = _.minBy(candles, o => o.low).low;
            let highest = _.maxBy(candles, o => o.high).high;
            // console.log('lowest:', lowest, ' highest:', highest, currentAssetPrice);
            let priceHasFallen = currentPrice > highest * this.dangerZoneRatio;


            if (!this.isInTrade()) {
                if (priceHasFallen) {
                    return this.buy();
                } else {
                    return this.hold();
                }
            } else {
                let stopped = this.stopLoss(0.2);
                if (stopped) return this.sell();

                stopped = this.takeProfit(0.01);
                if (stopped) return this.sell();

                return this.hold();
            }
        } catch (e) {
            console.error("Err: " + e.stack);
            process.exit(-1);
        }
    }
}

module.exports = WaveTrader;