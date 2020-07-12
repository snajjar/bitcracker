const Trader = require('./trader');
const tulind = require('tulind');
const _ = require('lodash');
const dt = require('../lib/datatools');

class WaveTrader extends Trader {
    constructor() {
        super();

        // parameters
        this.emaPeriods = 200;
        this.emaTrigger = 0.4;
        this.candleSize = 15;

        this.waveLength = (this.emaPeriods + 5) * this.candleSize; // get 5 EMA200 of 15min period
        this.dangerZoneRatio = 0.90;

        this.buyTreshold = 0.2;
        this.sellTreshold = -0.2;
    }

    analysisIntervalLength() {
        return this.waveLength;
    }

    hash() {
        return "Algo_Wave";
    }

    getEMA(candles) {
        let closePrices = _.map(candles, p => p.close);
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

    hasBigDown(candles, currentPrice) {
        let relevantCandles = candles.slice(candles.length - 700);
        let highest = _.maxBy(relevantCandles, c => c.high).high;
        return currentPrice < highest * 0.94;
    }

    // decide for an action
    async action(crypto, candles, currentPrice) {

        // BUY when at the lowest of the wave
        // SELL when at the highest
        try {
            let lowest = _.minBy(candles, o => o.low).low;
            let highest = _.maxBy(candles, o => o.high).high;

            let candles15 = dt.mergeCandlesBy(candles, this.candleSize);
            let ema = await this.getEMA(candles15);

            let last5EMA = ema.slice(ema.length - 5);

            let [a, b] = dt.linearRegression(_.range(last5EMA.length), last5EMA);
            let trendUp = a > this.buyTreshold;
            let trendDown = a < this.sellTreshold;

            // console.log('lowest:', lowest, ' highest:', highest, currentAssetPrice);
            //let priceHasFallen = currentPrice > highest * this.dangerZoneRatio;


            if (!this.isInTrade()) {
                if (this.hasBigDown(candles, currentPrice) && trendUp) {
                    return this.buy();
                } else {
                    return this.hold();
                }
            } else {
                // let stopped = this.stopLoss(0.2);
                // if (stopped) return this.sell();

                // stopped = this.takeProfit(0.01);
                // if (stopped) return this.sell();

                if (!trendDown) {
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