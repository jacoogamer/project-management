import { nodeResolve } from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import typescript from '@rollup/plugin-typescript';
import { terser } from 'rollup-plugin-terser';
import postcss from 'rollup-plugin-postcss';

export default {
  input: 'src/main.ts',
  output: {
    file: 'main.js',
    format: 'cjs',
    sourcemap: true,
    exports: 'auto'   // ensures default export compatibility warning is silenced
  },
  external: ['obsidian', 'moment'],
  plugins: [
    typescript({ tsconfig: './tsconfig.json' }), // <— leave it to tsconfig
    postcss(),
    nodeResolve({ browser: true }),
    commonjs(),
    terser()
  ]
};
