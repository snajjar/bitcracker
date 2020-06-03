const Trader = require('./trader');
const tulind = require('tulind');
const _ = require('lodash');

class WaveTrader extends Trader {
    constructor() {
        super();

        // parameters
        this.emaPeriods = 2;
        this.emaTrigger = 0.4;

        this.waveLength = 60 * 24 * 7;
        this.tolerance = 0.001;
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
    async action(crypto, candles, currentAssetPrice) {

        // BUY when at the lowest of the wave
        // SELL when at the highest
        try {
            let lowest = _.minBy(candles, o => o.close).close * (1 + this.tolerance);
            let highest = _.maxBy(candles, o => o.close).close * (1 - this.tolerance);
            // console.log('lowest:', lowest, ' highest:', highest, currentAssetPrice);

            if (!this.isInTrade()) {
                if (currentAssetPrice < lowest) {
                    return this.bid(currentAssetPrice);
                } else {
                    return this.hold();
                }
            } else {
                if (this.getCurrentTradeAsset() == crypto) {
                    if (currentAssetPrice > highest) {
                        // SELL conditions are take profit and stop loss
                        return this.ask(currentAssetPrice);
                    } else {
                        return this.hold();
                    }
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