module.exports = {
    // how to scale down the bitcoin price to a value between 0 and 1
    scalePrice: 10000,

    // number of periods of data we provide to the model to determine the output
    nbPeriods: 52, // base for ichimoku indicator

    // each of theses informations are processed through sigmoid function
    // We'll create a sequential model and train it on a set of nbPeriods period
    // Each period will have the following informations:
    // - open price
    // - high price
    // - low price
    // - close price
    // - vwap (volume weighted average price)
    // - volume // DISABLED
    // each of theses informations are processed through sigmoid function
    nbDataByPeriod: 5,

    trainingOptions: {
        shuffle: true,
        epochs: 100,
        batchsize: 100,
        validtionSplit: 0.2
    }
}