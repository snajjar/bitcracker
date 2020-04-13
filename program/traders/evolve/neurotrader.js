/******************************************************************************
 * neurotrader.js - ML-based trader adapted for genetic evolution
 *****************************************************************************/

const Trader = require('../trader');
const _ = require('lodash');
const tf = require('@tensorflow/tfjs-node');
const utils = require('../../lib/utils');
const modelData = require('./neuroTraderModel');
const objectHash = require('object-hash');

const mutationProbability = 1; // probability of mutation to occur on a new trader
const neuronMutationProbability = 0.02; // 1% probability of neuron mutation (if the trader mutates)

const nbDataInput = modelData.nbDataInput;
const nbModelInput = nbDataInput + 2;

// A neuro-evolvable trader
class NeuroTrader extends Trader {
    constructor(m) {
        super();
        if (m) {
            this.model = m;
        } else {
            this.model = NeuroTrader.newModel();
        }
    }

    analysisIntervalLength() {
        return modelData.nbPeriods;
    }

    // generate a new random trader
    static async random() {
        let t = new NeuroTrader();
        await t.mutate(1, 1); // randomize it
        return t;
    }

    static newModel() {
        return tf.sequential({
            layers: [
                // We get the nbDataInput from the classic model, plus 2 infos: if we have bitcoins and if we have euros
                tf.layers.dense({ inputShape: [nbModelInput], units: nbModelInput, activation: 'relu' }),
                //tf.layers.dropout(0.8),
                tf.layers.dense({ units: nbModelInput, activation: 'relu' }),
                //tf.layers.dropout(0.8),
                tf.layers.dense({ units: 3, activation: 'softmax' }),
            ]
        });
    }

    static async fromParents(parentA, parentB) {
        let t = await NeuroTrader.random();

        let weightsA = [];
        await parentA.reduceWeight(w => { weightsA.push(w); return; });

        let weightsB = [];
        await parentB.reduceWeight(w => { weightsB.push(w); return; });

        let index = 0;
        await t.reduceWeight(w => {
            let val = Math.random() < 0.5 ? weightsA[index] : weightsB[index]
            index++;
            return val;
        });

        return t;
    }

    static async clone(parent) {
        let t = await NeuroTrader.random();

        let weights = [];
        await parent.reduceWeight(w => { weights.push(w); return; });

        let index = 0;
        await t.reduceWeight(w => {
            let val = weights[index];
            index++;
            return val;
        });

        t.number = parent.number;

        return t;
    }

    async hash() {
        if (!this.modelHash) {
            let weights = [];
            await this.reduceWeight(w => { weights.push(w); return; });
            this.modelHash = objectHash(weights);
        }
        return this.modelHash;
    }

    async reduceWeight(f) {
        // for each layer, extract weight from parents
        // for each weight, rand() which one we choose
        // then set the result into layer
        let tensors = [];

        for (var i = 0; i < this.model.layers.length; i++) {
            let layer = this.model.layers[i];
            let layerWeights = layer.getWeights(); // Tensor[]
            let newLayerWeights = [];

            for (let j = 0; j < layerWeights.length; j++) {
                let tensor = layerWeights[j];
                let arr = await tensor.array();

                // now build our tensor
                let newArr = [];
                for (let k = 0; k < arr.length; k++) {
                    if (arr[k].length) {
                        let row = [];
                        for (let l = 0; l < arr[k].length; l++) {
                            let val = f(arr[k][l]);
                            if (val !== undefined) {
                                row.push(val);
                            } else {
                                row.push(arr[k][l]);
                            }
                        }
                        newArr.push(row);
                    } else {
                        let val = f(arr[k]);
                        if (val !== undefined) {
                            newArr.push(val);
                        } else {
                            newArr.push(arr[k]);
                        }
                    }
                }

                let dim1 = arr.length;
                let dim2 = arr[0].length;

                if (dim2) {
                    var newTensor = tf.tensor2d(newArr, [dim1, dim2], 'float32');
                } else {
                    var newTensor = tf.tensor1d(newArr);
                }

                newLayerWeights.push(newTensor);
                tensors.push(newTensor);
            }

            layer.setWeights(newLayerWeights);
        }

        // we're done, clean tensors
        _.each(tensors, t => t.dispose());
    }

    async mutate(mp = mutationProbability, nmp = neuronMutationProbability) {
        if (Math.random() < mp) {
            let p = await this.reduceWeight(w => {
                if (Math.random() < nmp) {
                    return Math.random();
                } else {
                    return w;
                }
            });
            delete this.modelHash; // delete the hash, it's not good anymore
        }
    }

    getInputTensor(periodArray) {
        let arr = [this.hasEuros(), this.hasBitcoins()];
        _.each(periodArray, (period) => {
            let activatedInputData = modelData.activateInput(period);
            _.each(activatedInputData, (v) => {
                arr.push(v);
            });
        });

        return tf.tensor2d(arr, [1, modelData.nbDataInput + 2], 'float32');
    }

    async action(lastPeriods) {
        // build input tensor
        let inputTensor = this.getInputTensor(lastPeriods);
        let outputTensor = this.model.predict(inputTensor);
        let arr = await outputTensor.data();

        // get the action from the output
        var maxVal = _.max(arr);
        var index = arr.indexOf(maxVal);

        tf.dispose(inputTensor);
        tf.dispose(outputTensor);

        switch (index) {
            case 0:
                return this.buy();
            case 1:
                return this.hold();
            case 2:
                return this.sell();
            default:
                throw "Unrecognized action of index: " + index;
        }
    }

    score() {
        // score is the global ROI of the trader
        // add the buy/sell tax into account
        return this.gain();
    }

    isReproductible() {
        return this.gain() > 0;
    }
}

module.exports = NeuroTrader;