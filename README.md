# statcheck-ml

statcheck-ml is the browser and npm port of statcheck-ml. It reads a
statistical result from text and checks its p-value against the test
statistic, without sending the text to a server. The demo page will be at
https://rasoulnorouzi.github.io/statcheck-ml-web/.

## Install

    npm install statcheck-ml

This works when the package is published. Until then, install it from the
repository:

    npm install rasoulnorouzi/statcheck-ml-web

## Stages

The pipeline has several stages. Each one reads the last stage's output.
This table lists every stage and says which ones this package has now.

| stage | in this package | function |
|---|---|---|
| kit loading and verification | yes | `loadKit` |
| normalise | yes | `normalize` |
| extract (regex baseline) | yes | `extract` |
| prefilter | not yet | |
| repair | not yet | |
| model (GRU-CRF, ONNX) | not yet | |
| group | not yet | |
| p-value check | not yet | |
| PDF reading in a browser | not yet | |

## Kit

This package ships with a kit: the shared spec, the trained model, and the
parity cases every port is measured against. See `kit/README.md` for what
the kit holds and how to verify it by hand.

## Tests

    npm test

The tests load the kit and check its hashes, then run every normalise and
extract case from `kit/parity/cases.json` against this package's code.
