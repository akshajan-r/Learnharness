/**
 * @silvia-odwyer/photon-node for the iPad runtime: photon's browser build
 * (same Rust/WASM library and API), initialized before first use. Desktop
 * pins photon-node 0.3.4; the closest browser release is 0.3.3, and the
 * functions LearnHarness uses (PhotonImage, resize, fliph/flipv) are
 * unchanged across 0.3.x.
 */
import init from "@silvia-odwyer/photon";

await init();

export * from "@silvia-odwyer/photon";
