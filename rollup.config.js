// import de nos plugins
import commonjs from 'rollup-plugin-commonjs'; // for ES5 dependencies (use commonjs and "require")
import resolve from 'rollup-plugin-node-resolve'; // for ES5 dependencies (resolve "require" from node_modules)
import postCss from 'rollup-plugin-postcss'; // import css into the .js bundle
import vue from 'rollup-plugin-vue';
import replace from 'rollup-plugin-replace';
//import { terser } from 'rollup-plugin-terser'; // minifyier

export default [{
        input: './web/client/src/index.js',
        output: {
            file: './public/index.js',
            format: 'cjs'
        },
        plugins: [
            replace({
                'process.env.NODE_ENV': JSON.stringify('production')
            }),
            postCss({ inject: true }),
            vue({ template: { compilerOptions: { pad: 'line' } } }),
            commonjs(),
            resolve(),
        ]
    }
    /*, {
    input: './web/client/src/index.js',
    output: {
        file: './public/index.min.js',
        format: 'cjs'
    },
    plugins: [
        replace({
            'process.env.NODE_ENV': JSON.stringify('production')
        }),
        postCss({ inject: true }),
        vue(),
        commonjs(),
        resolve(),
        terser(),
    ]
}*/
];