const Trader = require('./trader');
const _ = require('lodash');
const config = require('../config');
const CNNPriceVariationPredictionModel = require('../models/prediction/cnnPriceVariationPrediction');

class TraderCNNPredictVar extends Trader {
    constructor() {
        super();
        this.tresholdBuy = 0.01;
        this.tresholdSell = 0.01;
    }

    getDescription() {
        return "Try to speculate on bitcoin variations from a dense neural network trained to predict prices variations";
    }

    async initialize() {
        this.model = new CNNPriceVariationPredictionModel();
        let interval = config.getInterval();
        await this.model.load(interval);
        await this.model.initialize();
    }

    analysisIntervalLength() {
        return this.model.getNbInputPeriods() + 1;
    }

    hash() {
        return "ML_CNNPredictVar";
    }

    // predict next bitcoin price from period
    async predictPrice(dataPeriods) {
        return await this.model.predict(dataPeriods);
    }

    // decide for an action
    async action(crypto, dataPeriods, currentBitcoinPrice) {
        // let stopped = this.stopLoss(this.stopLossRatio);
        // if (stopped) return;

        // stopped = this.takeProfit(this.takeProfitRatio);
        // if (stopped) return;

        // get predictions
        let prediction = await this.predictPrice(dataPeriods);
        let bullish = prediction > currentBitcoinPrice * (1 + this.tresholdBuy);
        let bearish = prediction < currentBitcoinPrice * (1 - this.tresholdSell);

        if (!this.isInTrade()) {
            if (bullish) {
                // BUY condition
                return this.buy();
            } else {
                return this.hold();
            }
        } else {
            if (bearish) {
                return this.sell();
            } else {
                return this.hold();
            }
        }
    }
}

module.exports = TraderCNNPredictVar;