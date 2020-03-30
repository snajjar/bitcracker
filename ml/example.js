const tf = require('@tensorflow/tfjs-node');

const model = tf.sequential({
    layers: [
        tf.layers.dense({ inputShape: [784], units: 32, activation: 'relu' }),
        tf.layers.dense({ units: 10, activation: 'softmax' }),
    ]
});

model.compile({
    optimizer: 'adam',
    loss: 'meanSquaredError',
    metrics: ['accuracy']
});

// Generate dummy data.
const data = tf.randomNormal([100, 784]);
console.log(data.shape);
data.print();

const labels = tf.randomUniform([100, 10]);
console.log(labels.shape);
labels.print();


function onBatchEnd(batch, logs) {
    console.log('Accuracy', logs.acc);
}

// Train for 5 epochs with batch size of 32.
model.fit(data, labels, {
    epochs: 5,
    batchSize: 32,
    callbacks: { onBatchEnd }
}).then(info => {
    console.log('Final accuracy', info.history.acc);
});