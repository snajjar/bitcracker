const Trader = require('./trader');
const tulind = require('tulind');
const _ = require('lodash');

class PriceXEMATrader extends Trader {
    constructor() {
        super();

        // parameters
        this.emaPeriods = 200;

        this.tolerance = 0.0001;
        this.amplitude = 0.01;
        this.previousPosition = {};
    }

    analysisIntervalLength() {
        return Math.max(this.emaPeriods) + 1;
    }

    hash() {
        return "Algo_PricexEMA";
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
        // let stopped = this.stopLoss(this.stopLossRatio);
        // if (stopped) return;

        // stopped = this.takeProfit(this.takeProfitRatio);
        // if (stopped) return;

        // calculate sma indicator
        try {
            let ema = await this.getEMA(candles);
            let currEMA = ema[ema.length - 1];

            let priceCrossingEMAUp = this.previousPosition[asset] == "down" && currentAssetPrice >= currEMA * (1 + this.tolerance);
            let priceCrossingEMADown = this.previousPosition[asset] == "up" && currentAssetPrice <= currEMA * (1 - this.tolerance);
            this.previousPosition[asset] = currentAssetPrice > currEMA ? "up" : "down";

            // console.log('priceUp', priceCrossingSMAUp);
            // console.log('priceDown', priceCrossingSMADown);

            if (!this.isInTrade()) {
                if (priceCrossingEMAUp) {
                    // BUY condition
                    return this.buy();
                } else {
                    return this.hold();
                }
            } else {
                let stopped = this.stopLoss(this.amplitude - this.getSellTax());
                if (stopped) return this.sell();

                stopped = this.takeProfit(this.amplitude);
                if (stopped) return this.sell();

                return this.hold();

                // if (priceCrossingEMADown) {
                //     return this.sell();
                // } else {
                //     // SELL conditions are take profit and stop loss
                //     return this.hold();
                // }
            }
        } catch (e) {
            console.error("Err: " + e);
            process.exit(-1);
        }
    }
}

module.exports = PriceXEMATrader;