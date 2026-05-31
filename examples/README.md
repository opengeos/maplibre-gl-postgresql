# Examples

This directory contains example implementations of the MapLibre GL PostgreSQL control.

## Available Examples

### Basic Example
A vanilla TypeScript example showing how to add the PostgreSQL control to a map.

```bash
# Run from project root
npm run dev
# Then navigate to http://localhost:5173/examples/basic/
```

### React Example
A React example demonstrating the React wrapper component and hooks.

```bash
# Run from project root
npm run dev
# Then navigate to http://localhost:5173/examples/react/
```

## Running Examples

1. Install dependencies:
   ```bash
   npm install
   ```

2. Start the development server:
   ```bash
   npm run dev
   ```

3. Start the API server in another terminal with `npm --prefix server run dev`.

4. Open your browser and navigate to the example you want to view.

The examples expect a server source named `default` from `POSTGRESQL_SOURCES`.

## Building Examples

To build all examples for deployment:

```bash
npm run build:examples
```

The built examples will be in the `dist-examples` directory.
