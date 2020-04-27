const Trader = require('./trader');
const _ = require('lodash');
const config = require('../config');
const CNNGrowthPredictionModel = require('../models/prediction/cnnGrowthPrediction');

class TraderCNNGrowthPredict extends Trader {
    constructor() {
        super();

        this.buyTreshold = 0.01;
        this.sellTreshold = 0.01;
    }

    getDescription() {
        return "use a CNN to predict btc price, and buy/sell if prediction crosses a treshold";
    }

    async initialize() {
        this.model = new CNNGrowthPredictionModel();
        let interval = config.getInterval();
        await this.model.load();
        await this.model.initialize();
    }

    analysisIntervalLength() {
        // let's add some period to adjust prediction on local loss
        return this.model.getNbInputPeriods() + 5;
    }

    hash() {
        return "ML_CNNGrowthPredict";
    }

    // predict next bitcoin price from period
    async predictPrice(dataPeriods) {
        return await this.model.predict(dataPeriods);
    }

    // decide for an action
    async action(dataPeriods, currentBitcoinPrice) {
        // let stopped = this.stopLoss(this.stopLossRatio);
        // if (stopped) return;

        // stopped = this.takeProfit(this.takeProfitRatio);
        // if (stopped) return;

        let prediction = await this.predictPrice(dataPeriods);

        // calculate ema indicator
        if (!this.inTrade) {
            if ((1 + this.buyTreshold) < prediction) {
                // BUY condition
                return this.buy();
            } else {
                return this.hold();
            }
        } else {
            if ((1 - this.sellTreshold) > prediction) {
                // SELL condition
                return this.sell();
            } else {
                return this.hold();
            }
        }
    }
}

module.exports = TraderCNNGrowthPredict;