const Trader = require('./trader');
const tulind = require('tulind');
const _ = require('lodash');

class AbnormalVolume extends Trader {
    constructor() {
        super();

        // parameters
        this.emaPeriods = 2;
        this.emaTrigger = 0.4;

        this.volumeFactor = 2;
    }

    analysisIntervalLength() {
        return 700;
    }

    hash() {
        return "Algo_AbnormalVolume";
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
        let volumeAVG = _.meanBy(candles.slice(0, candles.length - 2), o => o.volume);
        let last = _.last(candles);

        let abnormalVolume = last.volume > volumeAVG * this.volumeFactor;
        let candleUp = last.close > last.open;
        let candleDown = last.close < last.open;
        // console.log('volume: ' + last.volume, 'avg volume:', volumeAVG);

        // calculate sma indicator
        try {
            let ema = await this.getEMA(candles);
            let lastEMA = _.last(ema);

            var diff = (currentPrice / lastEMA * 100) - 100;
            let bigDown = diff < -this.emaTrigger;
            let bigUp = diff > this.emaTrigger;

            if (!this.isInTrade()) {
                if (abnormalVolume && candleUp && bigDown) {
                    // BUY condition
                    return this.buy();
                } else {
                    return this.hold();
                }
            } else {
                if (abnormalVolume && candleDown && bigUp) {
                    // SELL conditions are take profit and stop loss
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

module.exports = AbnormalVolume;