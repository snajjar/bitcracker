const Trader = require('./trader');
const _ = require('lodash');
const tulind = require('tulind');
const tf = require('@tensorflow/tfjs-node');
const datatools = require('../lib/datatools');
const config = require('../config');
//const CNNPricePredictionModel = require('../models/prediction/cnnPricePrediction');
const CNNPriceMultiscale = require('../models/prediction/cnnPriceMultiscale');

class TraderCNNEMAPredict extends Trader {
    constructor() {
        super();

        // tune theses
        this.emaPeriods = 2;
        this.emaTrigger = 0.4;
        this.buyTreshold = 0.003;
        this.sellTreshold = 0.003;

        // model parameters
        this.retrainEvery = 1440 * 7; // 1 week
        this.newCandlesSinceRetrain = 0;
        this.minTrainPeriods = this.retrainEvery; // should be at least this.retrainEvery
        this.maxTrainPeriods = 1440 * 30; // 1 month

        this.history = [];
    }

    getDescription() {
        return "Use EMA to predict uptrends, then check it against a dense neural network trained to predict prices variations";
    }

    async initialize() {
        this.model = new CNNPriceMultiscale();
        this.model.settings.nbInputPeriods = 16;
        this.model.createModel();
        await this.model.compile();
        await this.model.initialize();
        this.model.trainingOptions.verbose = 0; // silent plz
        this.model.trainingOptions.epochs = 1;
    }

    analysisIntervalLength() {
        return Math.max(this.model.getNbInputPeriods(), this.emaPeriods) + 1;
    }

    hash() {
        return "ML_CNNEMARetrain";
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

    // predict next bitcoin price from period
    async predictPrice(dataPeriods) {
        return await this.model.predict(dataPeriods);
    }


    async logToHistory(dataPeriods) {
        if (this.history.length == 0) {
            // add all candles to history
            this.history = this.history.concat(dataPeriods);
        } else {
            // add last candle to history
            let lastCandle = dataPeriods[dataPeriods.length - 1];
            this.history.push(lastCandle);
        }

        if (this.history.length > this.maxTrainPeriods) {
            this.history.shift();
        }

        this.newCandlesSinceRetrain++;
        if (this.newCandlesSinceRetrain >= this.retrainEvery) {
            console.time(`Retraining model on ${this.history.length} last periods for ${this.model.trainingOptions.epochs} epochs`);
            await this.model.train(this.history);
            console.timeEnd(`Retraining model on ${this.history.length} last periods for ${this.model.trainingOptions.epochs} epochs`);
            this.newCandlesSinceRetrain = 0;
        }
    }

    // decide for an action
    async action(dataPeriods, currentBitcoinPrice) {
        // let stopped = this.stopLoss(this.stopLossRatio);
        // if (stopped) return;

        // stopped = this.takeProfit(this.takeProfitRatio);
        // if (stopped) return;


        if (this.history.length < this.minTrainPeriods) {
            this.hold();
            await this.logToHistory(dataPeriods);
        } else {
            let action = null;

            // calculate ema indicator
            try {
                let ema = await this.getEMA(dataPeriods);
                let currEMA = ema[ema.length - 1];

                var diff = (currentBitcoinPrice / currEMA * 100) - 100;
                let upTrend = diff < -this.emaTrigger;
                let downTrend = diff > this.emaTrigger;

                if (!this.inTrade) {
                    if (upTrend) {
                        // validate EMA strategy with next prediction
                        let prediction = await this.predictPrice(dataPeriods);
                        if (currentBitcoinPrice * (1 + this.buyTreshold) < prediction) {
                            // BUY condition
                            action = this.buy();
                        } else {
                            action = this.hold();
                        }
                    } else {
                        action = this.hold();
                    }
                } else {
                    if (downTrend) {
                        // validate EMA strategy with next prediction
                        let prediction = await this.predictPrice(dataPeriods);
                        if (currentBitcoinPrice * (1 - this.sellTreshold) > prediction) {
                            // SELL conditions are take profit and stop loss
                            action = this.sell();
                        } else {
                            action = this.hold();
                        }
                    } else {
                        action = this.hold();
                    }
                }
            } catch (e) {
                console.error("Err: " + e.stack);
                process.exit(-1);
            }

            await this.logToHistory(dataPeriods);
            return action;
        }
    }
}

module.exports = TraderCNNEMAPredict;