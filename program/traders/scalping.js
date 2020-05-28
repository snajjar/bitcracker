const Trader = require('./trader');
const tulind = require('tulind');
const _ = require('lodash');

class ScalpingTrader extends Trader {
    constructor() {
        super();

        // parameters
        this.emaPeriods = 2;
        this.emaUpTrigger = 0.4;
        this.emaDownTrigger = 0.2;

        // trade decision making
        this.isInTrade() = false;
        this.enterTradeValue = 0;
        this.timeInTrade = 0;
        this.maxTimeInTrade = 1440 * 3; // 1 day
        this.objective = 0.15;
        this.step = (0.1 - this.getBuyTax() + this.getSellTax()) / this.maxTimeInTrade;
    }

    analysisIntervalLength() {
        //return this.emaPeriods + 1;
        return 50;
    }

    hash() {
        return "Algo_scalping";
    }

    getAVG(dataPeriods) {
        return _.meanBy(dataPeriods, 'close')
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
    async action(crypto, dataPeriods, currentBitcoinPrice) {
        // let stopped = this.stopLoss(this.stopLossRatio);
        // if (stopped) return;

        // stopped = this.takeProfit(this.takeProfitRatio);
        // if (stopped) return;

        let ema = await this.getEMA(dataPeriods);
        let currEMA = ema[ema.length - 1];

        var diff = (currentBitcoinPrice / currEMA * 100) - 100;
        let bigDown = diff < -this.emaDownTrigger;
        let bigUp = diff > this.emaUpTrigger;

        if (!this.isInTrade()) {
            if (bigDown) {
                // BUY condition
                this.timeInTrade = 0;
                this.objective = 0.1;
                return this.buy();
            } else {
                return this.hold();
            }
        } else {
            this.timeInTrade++;
            let objectivePrice = this.enterTradeValue * (1 + this.objective - this.timeInTrade * this.step);
            if (currentBitcoinPrice > objectivePrice || bigUp) {
                this.sell();
            } else {
                return this.hold();
            }
        }
    }
}

module.exports = ScalpingTrader;