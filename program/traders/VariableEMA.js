const Trader = require('./trader');
const tulind = require('tulind');
const _ = require('lodash');

class VariableEMATrader extends Trader {
    constructor() {
        super();

        // parameters
        this.emaPeriods = 2;
        this.emaTrigger = 0.4;
    }

    analysisIntervalLength() {
        return this.emaPeriods + 1;
    }

    hash() {
        return "Algo_VariableEMA";
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
    async action(dataPeriods, currentBitcoinPrice) {
        // let stopped = this.stopLoss(this.stopLossRatio);
        // if (stopped) return;

        // stopped = this.takeProfit(this.takeProfitRatio);
        // if (stopped) return;

        // calculate sma indicator
        try {
            let ema = await this.getEMA(dataPeriods);
            let currEMA = ema[ema.length - 1];
            var diff = (currentBitcoinPrice / currEMA * 100) - 100;
            let trendUp, trendDown;

            if (this.inTrade) {
                // the more we past our objective, the more we want to pay attention
                // price variations.
                let objectiveRatio = currentBitcoinPrice / this.objective;
                trendDown = diff > this.emaTrigger / Math.pow(objectiveRatio, 1.7);
            } else {
                trendUp = diff < -this.emaTrigger;
            }

            if (!this.inTrade) {
                if (trendUp) {
                    // BUY condition

                    this.objective = currentBitcoinPrice * (1 + this.buyTax + this.sellTax);

                    return this.buy();
                } else {
                    return this.hold();
                }
            } else {
                if (trendDown) {
                    // SELL conditions are take profit and stop loss
                    this.objective = null;
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

module.exports = VariableEMATrader;