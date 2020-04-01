const MathUtils = {
	lerp(a, b, t) {
		return a + t * (b - a);
	},
};

class Agent {
	constructor(
		brain = new NeuralNetwork(
			null,
			new NeuralNetworkLayer(2),
			new NeuralNetworkLayer(2),
			new NeuralNetworkLayer(1)
		),
	) {
		this.boundingBox = new Rectangle();
		this.brain = brain;
		this.isAlive = true;
		this.position = new Vector2();
		this.score = 0;
	}

	dispose() {
		this.brain.dispose();
	}

	kill() {
		this.isAlive = false;
	}

	render(context) {
		context.save();

		context.globalCompositeOperation = 'darken';
		context.fillStyle = this.isAlive
			? '#ea2d2d'
			: '#dde1e4';

		context.fillRect(
			this.boundingBox.left,
			this.boundingBox.top,
			this.boundingBox.width,
			this.boundingBox.height);

		context.restore();
	}

	update(context, target) {
		const { width } = context.canvas;
		const sizeHalf = 0.5 * Agent.SIZE;

		const output = this.brain.predict([this.position.x, target])
			.dataSync();

		this.position.x += Agent.SPEED * output[0];
		this.position.x = Math.max(sizeHalf, Math.min(width - sizeHalf, this.position.x));

		this.updateBoundingBox();
	}

	updateBoundingBox() {
		const sizeHalf = 0.5 * Agent.SIZE;

		this.boundingBox.left = this.position.x - sizeHalf;
		this.boundingBox.right = this.position.x + sizeHalf;
		this.boundingBox.top = this.position.y - sizeHalf;
		this.boundingBox.bottom = this.position.y + sizeHalf;
	}

	static get SIZE() {
		return 8;
	}

	static get SPEED() {
		return 64;
	}

	static fromParents(a, b) {
		return new Agent(NeuralNetwork.fromParents(a.brain, b.brain));
	}
}

class NeuralNetwork {
	constructor(weights, ...layers) {
		this.inputLayerSize = layers[0].size;
		this.layers = layers;

		this.weights = weights || layers
			.slice(0, layers.length - 1)
			.map((layer, index) => {
				const layerSizeNext = layers[index + 1].size;

				return tf.randomUniform([layer.size, layerSizeNext], -1, 1);
			});
	}

	dispose() {
		this.weights
			.forEach(w => w.dispose());
	}

	getWeights() {
		return this.weights
			.map(weights => weights.dataSync());
	}

	predict(input) {
		return tf.tidy(() => {
			const inputLayer = tf.tensor(input, [1, this.inputLayerSize]);

			return this.weights.reduce((layer, weights, index) => {
				const fn = this.layers[index].fn;
				const result = layer.matMul(weights);

				return result[fn]()
					.sub(tf.scalar(0.5));
			}, inputLayer);
		});
	}

	static get MUTATION_PROBABILITY() {
		return 0.05;
	}

	static fromParents(a, b) {
		const weightsA = a.getWeights();
		const weightsB = b.getWeights();
		const weightsC = new Float32Array(weightsA.length).fill()
			.map(_ => Math.random() * 2 - 1);

		const weights = new Array(weightsA.length).fill()
			.map((_, index) => {
				const a = weightsA[index];
				const b = weightsB[index];

				return new Float32Array(a.length).fill()
					.map((_, weightIndex) => {
						if (Math.random() < NeuralNetwork.MUTATION_PROBABILITY) {
							return Math.random() * 2 - 1;
						}

						return Math.random() < 0.5
							? a[weightIndex]
							: b[weightIndex];
					});
			})
			.map((arr, index) => tf.tensor(arr, a.weights[index].shape));

		return new NeuralNetwork(weights, ...a.layers);
	}
}

class NeuralNetworkLayer {
	constructor(size, fn = 'sigmoid') {
		this.fn = fn;
		this.size = size;
	}
}

class Obstacle {
	constructor(gapSize) {
		this.gapSize = gapSize;
		this.gapSizeHalf = 0.5 * gapSize;
		this.position = new Vector2();
	}

	render(context) {
		const { width } = context.canvas;

		context.save();
		context.beginPath();

		context.moveTo(0, this.position.y);
		context.lineTo(this.position.x - this.gapSizeHalf, this.position.y);
		context.moveTo(this.position.x + this.gapSizeHalf, this.position.y);
		context.lineTo(width, this.position.y);

		context.lineWidth = Agent.SIZE;
		context.strokeStyle = '#444f56';
		context.stroke();
		context.restore();
	}

	overlaps(context, rectangle) {
		const { width } = context.canvas;

		const a = new Rectangle(
			new Vector2(0, this.position.y),
			new Vector2(this.position.x - this.gapSizeHalf, this.position.y),
		);
		const b = new Rectangle(
			new Vector2(this.position.x + this.gapSizeHalf, this.position.y),
			new Vector2(width, this.position.y),
		);

		return (
			Rectangle.overlap(rectangle, a) ||
			Rectangle.overlap(rectangle, b)
		);
	}
}

class Population {
	constructor(size) {
		this.agents = new Array(size).fill().map(_ => new Agent());
		this.generation = 0;
		this.size = size;
	}

	get isAlive() {
		return this.agents.some(a => a.isAlive);
	}

	dispose() {
		this.agents.forEach(a => a.dispose());
	}

	next() {
		const agents = this.agents;
		const parents = this.agents
			.sort((a, b) => b.score < a.score ? -1 : 1)
			.slice(0, 2);

		this.agents = this.agents.map(() => Agent.fromParents(...parents));

		agents.forEach(a => a.dispose());

		++this.generation;
	}

	setAgentPosition(position) {
		this.agents.forEach((agent) => {
			agent.position.copy(position);
			agent.updateBoundingBox();
		});
	}
}

class Rectangle {
	constructor(v1 = new Vector2, v2 = new Vector2) {
		this._left = Math.min(v1.x, v2.x);
		this._right = Math.max(v1.x, v2.x);
		this._top = Math.min(v1.y, v2.y);
		this._bottom = Math.max(v1.y, v2.y);

		this.updateSize();
	}

	get bottom() {
		return this._bottom;
	}

	set bottom(value) {
		this._bottom = value;
		this.updateSize();
	}

	get left() {
		return this._left;
	}

	set left(value) {
		this._left = value;
		this.updateSize();
	}

	get right() {
		return this._right;
	}

	set right(value) {
		this._right = value;
		this.updateSize();
	}

	get top() {
		return this._top;
	}

	set top(value) {
		this._top = value;
		this.updateSize();
	}

	updateSize() {
		this.height = this._bottom - this._top;
		this.width = this._right - this._left;
	}

	static overlap(a, b) {
		if (
			a.left > b.right || b.left > a.right ||
			a.bottom < b.top || b.bottom < a.top
		) return false;

		return true;
	}
}

class Vector2 {
	constructor(x = 0, y = 0) {
		this.x = x;
		this.y = y;
	}

	addScalar(s) {
		this.x += s;
		this.y += s;
		return this;
	}

	clone() {
		return new Vector2(this.x, this.y);
	}

	copy(v) {
		this.x = v.x;
		this.y = v.y;
		return this;
	}

	subtractScalar(s) {
		this.x -= s;
		this.y -= s;
		return this;
	}
}

const animate = (fn) => {
	let frame = 0;

	const reset = () => (frame = 0);
	const update = (time) => {
		requestAnimationFrame(update);
		fn(time, frame++, reset);
	};

	update(performance.now());
};

const context = document.getElementById('canvas').getContext('2d');
context.canvas.height = 512;
context.canvas.width = 512;

const elementParamAgentsAlive = document.getElementById('param-agents-alive');
const elementParamGeneration = document.getElementById('param-generation');
const elementParamHighscore = document.getElementById('param-highscore');

let highscore = 0;

const agentPositionOriginal = new Vector2(
	0.5 * context.canvas.width,
	context.canvas.height - 2 * Agent.SIZE
);

const obstacle = new Obstacle(8 * Agent.SIZE);
obstacle.position.x = context.canvas.width * Math.random();
let isUnloaded = false;

const population = new Population(8);
population.setAgentPosition(agentPositionOriginal);

animate((time, frame, reset) => {
	if (isUnloaded) return;

	if (!population.isAlive) {
		population.next();
		population.setAgentPosition(agentPositionOriginal);
		reset();
		return;
	}

	const { height, width } = context.canvas;
	const obstacleFrameLoop = (frame % 120) / 120;

	context.clearRect(0, 0, width, height);

	if (obstacleFrameLoop === 0) {
		obstacle.position.x = MathUtils.lerp(
			2 * Agent.SIZE,
			width - 2 * Agent.SIZE,
			Math.random()
		);
	}

	obstacle.position.y = height * obstacleFrameLoop;
	obstacle.render(context);

	population.agents.forEach((agent) => {
		if (agent.isAlive) {
			agent.update(context, obstacle.position.x);
			agent.score += (512 - Math.abs(agent.position.x - obstacle.position.x)) / 512;
		}

		if (obstacle.overlaps(context, agent.boundingBox)) {
			agent.kill();
		}

		agent.render(context);
	});

	highscore = Math.max(highscore, population.agents.reduce((highscore, a) => Math.max(highscore, a.score), 0));

	elementParamAgentsAlive.textContent = population.agents.filter(a => a.isAlive).length;
	elementParamGeneration.textContent = population.generation;
	elementParamHighscore.textContent = highscore.toFixed(2);
});

window.addEventListener('beforeunload', () => {
	population.dispose();
	isUnloaded = true;
});