const config = require('./config');

const k = 10000; // for sigmoid with larger numbers
const sigmoid = function(x) {
    return 1 / (1 + Math.exp(-x / k));
}

const logit = function(x) {
    return k * Math.log(x / (1 - x));
}

const priceScaleDown = function(x) {
    //return x / config.scalePrice;
    return sigmoid(x);
}

const priceScaleUp = function(x) {
    //x = logit(x);
    //return x * config.scalePrice;
    return logit(x);
}

const spreadScaleDown = function(x) {
    x = x / config.scalePrice;
    x = sigmoid(x);
    // since spread is always positive, map it between 0 and 1 instead 0.5 and 1
    x = (x - 0.5) * 2;
    return x;
}

const spreadScaleUp = function(x) {
    x = (x / 2) + 0.5; // retrieve from our mapping
    x = logit(x);
    x = x * config.scalePrice;
    return x;
}

module.exports = {
    sigmoid,
    logit,
    priceScaleDown,
    priceScaleUp,
    spreadScaleDown,
    spreadScaleUp,
}