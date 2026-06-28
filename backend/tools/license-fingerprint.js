#!/usr/bin/env node
/**
 * Print the current machine's hardware fingerprint and MAC addresses.
 *
 * Run this ON THE CUSTOMER SERVER (inside the backend container for an exact
 * match) and give the output to the vendor so a license can be bound to it.
 *
 * Usage:  node tools/license-fingerprint.js
 */
const ls = require("../services/licenseSecurity");

const macs = ls.collectMacAddresses();
const fingerprint = ls.getHardwareFingerprint();
const machineId = ls.readMachineId();

console.log(JSON.stringify({
  macAddresses: macs,
  machineId: machineId || null,
  fingerprint,
  hostMacOverride: process.env.HOST_MAC || null,
}, null, 2));
