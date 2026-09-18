import { test } from 'node:test';
import assert from 'node:assert/strict';

test('test harness runs and express is importable', async () => {
  const express = (await import('express')).default;
  assert.equal(typeof express, 'function');
});
