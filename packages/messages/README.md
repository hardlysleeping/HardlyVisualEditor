# @hardlyui/messages

One file of rules that turn backend failures into a sentence someone can act on.

The guest runtime, the inspector app and the SDK overlay each ship on their own —
injected into a host page, bundled into the plugin, published to npm — so none of
them may import a shared dependency at runtime. The source therefore lives here
and is copied into each package:

```sh
npm run vendor:messages   # write the copies
npm run check:messages    # fail if any copy has drifted
```

`src/messages.ts` is the only file to edit. Never edit the generated copies:
their header says so, and `npm run checks` fails when they differ.
