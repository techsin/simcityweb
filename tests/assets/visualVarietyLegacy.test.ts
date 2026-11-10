/** Saved appearances from round 1, before adding rowhouse and boutique facade families. */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { registerAllModels } from '../../src/assets/builders';
import { MANIFEST_BY_ID } from '../../src/assets/manifest';
import { getModelGeometry } from '../../src/assets/registry';

const EXPECTED: Record<string, string> = {
  "res_rowhouses": "e1717ae9ff5045a8b81e832200277a63bcc3d028a02467e7e5c459807eca04fa",
  "com_boutique": "8092e556778e2f1c49de3e2e4a44b924d1021fb3eb549f2872ae40365b6b6171",
  "res_walkup": "f471afca445ab1d35db39d8f670888aff87209d850329c6fb4c30039b8f75e35",
  "com_corner_store": "babedc0a813b6a2a16265b8db39f892f11739df8ade1ccdc0626680e3e800d5b",
  "com_shops_apartments": "852db29d46d0edfecf4cadff513178a91d2875c7df54a8341215e28e0a5d5bec",
  "com_office_block": "317bfb2028b1a3d1418485c4d147aa37c8625a523a304b341a7b00b1b156663d",
  "res_walkup_hip": "cda672f340f194c48bc6d5b68fe9a799e41cf3c7505d974ed00b9c817f624f11",
  // QA round 3 re-paletted these two round-1 models (their six palettes were shades of one hue): the round-3 colours.
  // Their shape did not change: see SHAPE below.
  "res_walkup_monitor": "6e75f9e4d9d05737314dd847bed09873164d3967abe33e9adb78afbf769d7110",
  "res_walkup_gables": "4fbf27e5096853805c750505708134abbefada1144cc1ff7b48c9f24b52cc49c",
  "com_corner_store_hip": "50ace6eb6a18f055c77d801faad9f15485828ab200a387752f1aeef42f9b22c0",
  "com_corner_store_gable": "87af502eb2ddfbed4228604bae80f92b169b141fbb026ab8b16ad1070c2aa49a",
  "com_corner_store_steps": "002152639a792f9ebf022904181a90add117b883a744bf8e75df6d182d5f2d0e",
  "com_shops_apartments_hip": "0f79ee4b4092d727a90970a59cdbae280796e4140582a9ff2fc198d937fa4c6c",
  "com_shops_apartments_gables": "3406be3d12cafb5e96c953a8ec3c0b705a304a66f415447449b24c32e6c50bb5",
  "com_shops_apartments_terrace": "de49de5e0564ed6fd26200819ccb137352ad63e2e11c79836052ac50fb0c4ec1",
  "com_office_block_steps": "dae14791db51788c52e36b0e1da0a19b2db6357099313aa2f377cf27d91a0f80",
  "com_office_block_sawtooth": "2af4990abc08418e71ec7c6f1739912354a56082bc5b31edf57ab7b42f7065cf",
  "com_office_block_vault": "503c7532e992280cdbb61bc7763e324aa9a0e5e724751112ba444807dd478d4a"
};

/** Positions, normals and surfaces alone (no colour), captured at round 2 (b0781cd) for the two re-paletted models. */
const SHAPE: Record<string, string> = {
  "res_walkup_monitor": "60172771ef614e371c193cd84aaaa857c7adbb6c7e6aea7e60e27450da0f69de",
  "res_walkup_gables": "0020693d7417ccecd2f21ef71914303adc1b3eea4ab41c07989aa24c365a458d",
};

registerAllModels();

function lookHash(id: string, names?: readonly string[]): string {
  const hash = createHash('sha256');
  for (let v = 0; v < MANIFEST_BY_ID[id].variants; v++) {
    const g = getModelGeometry(id, v);
    hash.update(String(v));
    for (const name of names ?? Object.keys(g.attributes).sort()) {
      const a = g.getAttribute(name);
      hash.update(`${name}:${a.itemSize}:${a.normalized}:`);
      hash.update(Buffer.from(a.array.buffer, a.array.byteOffset, a.array.byteLength));
    }
  }
  return hash.digest('hex');
}

describe('NEW-01 round 2 saved appearances', () => {
  it.each(Object.entries(EXPECTED))('%s keeps every original and mirrored variant byte-identical', (id, expected) => {
    expect(lookHash(id)).toBe(expected);
  });

  it.each(Object.entries(SHAPE))('%s keeps its round-2 shape under the round-3 palette (only vertex colours changed)', (id, expected) => {
    expect(Object.keys(getModelGeometry(id, 0).attributes).sort()).toEqual(['color', 'normal', 'position', 'surf']);
    expect(lookHash(id, ['normal', 'position', 'surf'])).toBe(expected);
  });
});

