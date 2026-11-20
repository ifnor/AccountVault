(() => {
  if (window.__accountVaultWebAuthnInjected) return;
  window.__accountVaultWebAuthnInjected = true;

  if (!navigator.credentials || typeof navigator.credentials.create !== "function") return;

  const origCreate = navigator.credentials.create.bind(navigator.credentials);
  const origGet = navigator.credentials.get.bind(navigator.credentials);

  function toUint8(buf) {
    if (!buf) return new Uint8Array(0);
    if (buf instanceof Uint8Array) return buf;
    if (ArrayBuffer.isView(buf)) return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    if (buf instanceof ArrayBuffer) return new Uint8Array(buf);
    return new Uint8Array(0);
  }

  function b64urlEncode(bytes) {
    const u8 = toUint8(bytes);
    let bin = "";
    for (let i = 0; i < u8.length; i++) bin += String.fromCharCode(u8[i]);
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  }

  function b64urlDecode(str) {
    const pad = str.length % 4 === 0 ? "" : "=".repeat(4 - (str.length % 4));
    const b64 = (str + pad).replace(/-/g, "+").replace(/_/g, "/");
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function concatBytes(...arrays) {
    let total = 0;
    for (const a of arrays) total += a.length;
    const out = new Uint8Array(total);
    let off = 0;
    for (const a of arrays) {
      out.set(a, off);
      off += a.length;
    }
    return out;
  }

  // Minimal deterministic CBOR encoder for WebAuthn attestationObject & COSE_Key
  function cborHead(major, len) {
    const m = major << 5;
    if (len < 24) return new Uint8Array([m | len]);
    if (len < 256) return new Uint8Array([m | 24, len]);
    if (len < 65536) return new Uint8Array([m | 25, len >> 8, len & 0xff]);
    return new Uint8Array([m | 26, (len >>> 24) & 0xff, (len >>> 16) & 0xff, (len >>> 8) & 0xff, len & 0xff]);
  }

  function cborEncode(val) {
    if (typeof val === "number") {
      if (val >= 0) return cborHead(0, val);
      return cborHead(1, -1 - val);
    }
    if (typeof val === "string") {
      const b = new TextEncoder().encode(val);
      return concatBytes(cborHead(3, b.length), b);
    }
    if (val instanceof Uint8Array) {
      return concatBytes(cborHead(2, val.length), val);
    }
    if (Array.isArray(val)) {
      const parts = [cborHead(4, val.length)];
      for (const item of val) parts.push(cborEncode(item));
      return concatBytes(...parts);
    }
    if (val instanceof Map) {
      const parts = [cborHead(5, val.size)];
      for (const [k, v] of val.entries()) {
        parts.push(cborEncode(k), cborEncode(v));
      }
      return concatBytes(...parts);
    }
    if (val && typeof val === "object") {
      const entries = Object.entries(val);
      const parts = [cborHead(5, entries.length)];
      for (const [k, v] of entries) {
        parts.push(cborEncode(k), cborEncode(v));
      }
      return concatBytes(...parts);
    }
    return new Uint8Array([0xf6]); // null
  }

  // Convert WebCrypto IEEE P1363 (r || s) 64-byte signature to ASN.1 DER
  function p1363ToDer(sigBytes) {
    const r = sigBytes.subarray(0, 32);
    const s = sigBytes.subarray(32, 64);
    const trimInt = (buf) => {
      let i = 0;
      while (i < buf.length - 1 && buf[i] === 0) i++;
      let sliced = buf.subarray(i);
      if (sliced[0] & 0x80) {
        return concatBytes(new Uint8Array([0x00]), sliced);
      }
      return sliced;
    };
    const rDer = trimInt(r);
    const sDer = trimInt(s);
    const seqLen = 2 + rDer.length + 2 + sDer.length;
    return concatBytes(
      new Uint8Array([0x30, seqLen, 0x02, rDer.length]),
      rDer,
      new Uint8Array([0x02, sDer.length]),
      sDer
    );
  }

  function askContent(action, payload) {
    return new Promise((resolve) => {
      const reqId = Math.random().toString(36).slice(2) + Date.now().toString(36);
      const onMsg = (ev) => {
        if (ev.source !== window || !ev.data || ev.data.type !== "AV_WEBAUTHN_RESP" || ev.data.reqId !== reqId) {
          return;
        }
        window.removeEventListener("message", onMsg);
        resolve(ev.data.result);
      };
      window.addEventListener("message", onMsg);
      const targetOrigin =
        window.location.origin && window.location.origin !== "null" ? window.location.origin : "*";
      window.postMessage({ type: "AV_WEBAUTHN_REQ", reqId, action, payload }, targetOrigin);
      setTimeout(() => {
        window.removeEventListener("message", onMsg);
        resolve({ fallback: true });
      }, 60000);
    });
  }

  async function sha256(bytes) {
    return new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  }

  function pad32(bytes) {
    if (bytes.length === 32) return bytes;
    if (bytes.length > 32) return bytes.subarray(bytes.length - 32);
    const out = new Uint8Array(32);
    out.set(bytes, 32 - bytes.length);
    return out;
  }

  function detectCrossOrigin() {
    try {
      if (window.top === window) return false;
      return window.top.location.origin !== window.location.origin;
    } catch {
      return true;
    }
  }

  function makeCredentialResponseObj(credIdBytes, responseObj, clientExtResults, attachment) {
    const rawId = credIdBytes.buffer.slice(credIdBytes.byteOffset, credIdBytes.byteOffset + credIdBytes.byteLength);
    const id = b64urlEncode(credIdBytes);
    const extResults = clientExtResults || {};
    const obj = typeof PublicKeyCredential !== "undefined"
      ? Object.create(PublicKeyCredential.prototype)
      : {};
    Object.defineProperties(obj, {
      id: { value: id, enumerable: true },
      rawId: { value: rawId, enumerable: true },
      type: { value: "public-key", enumerable: true },
      authenticatorAttachment: { value: attachment || "platform", enumerable: true },
      response: { value: responseObj, enumerable: true },
      getClientExtensionResults: { value: () => extResults, enumerable: true }
    });
    return obj;
  }

  // Fixed non-zero AAGUID for AccountVault (a0c7f2e4-8b1d-4e9a-9c3f-7a5d2e1b0f48)
  const ACCOUNTVAULT_AAGUID = new Uint8Array([
    0xa0, 0xc7, 0xf2, 0xe4, 0x8b, 0x1d, 0x4e, 0x9a,
    0x9c, 0x3f, 0x7a, 0x5d, 0x2e, 0x1b, 0x0f, 0x48
  ]);

  function selectSupportedAlg(pubKeyCredParams) {
    const algs = (pubKeyCredParams || []).map((p) => p.alg);
    if (algs.length === 0) return -7;
    if (algs.includes(-7)) return -7;
    if (algs.includes(-257)) return -257;
    return null;
  }

  function makeAttestationResponseObj(props) {
    const resp = typeof AuthenticatorAttestationResponse !== "undefined"
      ? Object.create(AuthenticatorAttestationResponse.prototype)
      : {};
    Object.defineProperties(resp, {
      clientDataJSON: { value: props.clientDataJSON, enumerable: true },
      attestationObject: { value: props.attestationObject, enumerable: true },
      getTransports: { value: () => props.transports || ["internal"], enumerable: true },
      getAuthenticatorData: { value: () => props.authDataBuf, enumerable: true },
      getPublicKey: { value: () => props.spkiBuf, enumerable: true },
      getPublicKeyAlgorithm: { value: () => props.alg || -7, enumerable: true }
    });
    return resp;
  }

  function makeAssertionResponseObj(props) {
    const resp = typeof AuthenticatorAssertionResponse !== "undefined"
      ? Object.create(AuthenticatorAssertionResponse.prototype)
      : {};
    Object.defineProperties(resp, {
      clientDataJSON: { value: props.clientDataJSON, enumerable: true },
      authenticatorData: { value: props.authenticatorData, enumerable: true },
      signature: { value: props.signature, enumerable: true },
      userHandle: { value: props.userHandle, enumerable: true }
    });
    return resp;
  }

  navigator.credentials.create = async function (options) {
    if (!options || !options.publicKey) {
      return origCreate(options);
    }
    if (options.signal?.aborted) {
      throw new DOMException("The operation was aborted.", "AbortError");
    }
    const pk = options.publicKey;
    // Immediately pass through requests that strictly require FIDO MDS hardware attestation
    if (pk.attestation === "direct" || pk.attestation === "enterprise") {
      return origCreate(options);
    }
    const isCrossPlatform = pk.authenticatorSelection?.authenticatorAttachment === "cross-platform";
    const attachment = isCrossPlatform ? "cross-platform" : "platform";
    const transports = isCrossPlatform ? ["usb"] : ["internal"];
    const chosenAlg = selectSupportedAlg(pk.pubKeyCredParams);
    if (chosenAlg === null) {
      return origCreate(options);
    }

    const rpId = pk.rp?.id || location.hostname;
    const rpName = pk.rp?.name || rpId;
    const userName = pk.user?.name || "";
    const userDisplayName = pk.user?.displayName || userName;
    const userId = b64urlEncode(toUint8(pk.user?.id));
    const excludeIds = (pk.excludeCredentials || []).map((c) => b64urlEncode(toUint8(c.id)));

    const decision = await askContent("CREATE_PROMPT", {
      rpId,
      rpName,
      userName,
      userDisplayName,
      excludeIds,
      isCrossPlatform
    });

    if (options.signal?.aborted) {
      throw new DOMException("The operation was aborted.", "AbortError");
    }
    if (decision && decision.excluded) {
      throw new DOMException(
        "The user attempted to register an authenticator that contains one of the credentials already registered with the relying party.",
        "InvalidStateError"
      );
    }
    if (!decision || decision.fallback) {
      return origCreate(options);
    }

    // Generate ES256 (ECDSA P-256) or RS256 (RSA-2048) keypair
    const keyGenParams = chosenAlg === -257
      ? {
          name: "RSASSA-PKCS1-v1_5",
          modulusLength: 2048,
          publicExponent: new Uint8Array([1, 0, 1]),
          hash: "SHA-256"
        }
      : { name: "ECDSA", namedCurve: "P-256" };

    const keyPair = await crypto.subtle.generateKey(keyGenParams, true, ["sign", "verify"]);
    const jwk = await crypto.subtle.exportKey("jwk", keyPair.privateKey);
    const spkiBuf = await crypto.subtle.exportKey("spki", keyPair.publicKey);
    const spkiBytes = new Uint8Array(spkiBuf);
    const credIdBytes = crypto.getRandomValues(new Uint8Array(32));
    const credIdB64 = b64urlEncode(credIdBytes);

    const clientDataStr = JSON.stringify({
      type: "webauthn.create",
      challenge: b64urlEncode(toUint8(pk.challenge)),
      origin: location.origin,
      crossOrigin: detectCrossOrigin()
    });
    const clientDataBytes = new TextEncoder().encode(clientDataStr);

    const rpIdHash = await sha256(new TextEncoder().encode(rpId));
    // Platform passkey: UP|UV|BE|BS|AT (0x5d); Roaming security key simulation: UP|UV|AT (0x45)
    const flags = new Uint8Array([isCrossPlatform ? 0x45 : 0x5d]);
    const signCount = new Uint8Array(4); // 0
    const aaguid = ACCOUNTVAULT_AAGUID;
    const credIdLen = new Uint8Array([(credIdBytes.length >> 8) & 0xff, credIdBytes.length & 0xff]);

    const coseKey = chosenAlg === -257
      ? new Map([
          [1, 3],     // kty: RSA
          [3, -257],  // alg: RS256
          [-1, b64urlDecode(jwk.n)],
          [-2, b64urlDecode(jwk.e)]
        ])
      : new Map([
          [1, 2],   // kty: EC2
          [3, -7],  // alg: ES256
          [-1, 1],  // crv: P-256
          [-2, pad32(b64urlDecode(jwk.x))],
          [-3, pad32(b64urlDecode(jwk.y))]
        ]);
    const coseBytes = cborEncode(coseKey);

    const authData = concatBytes(rpIdHash, flags, signCount, aaguid, credIdLen, credIdBytes, coseBytes);
    // Canonical CBOR key order: length-first then lexicographical ("fmt":3, "attStmt":7, "authData":8)
    const attestationObject = cborEncode(
      new Map([
        ["fmt", "none"],
        ["attStmt", new Map()],
        ["authData", authData]
      ])
    );

    const saveRes = await askContent("SAVE_PASSKEY", {
      rpId,
      rpName,
      userId,
      userName,
      userDisplayName,
      credentialId: credIdB64,
      privateKeyJwk: JSON.stringify(jwk),
      publicKeySpki: b64urlEncode(spkiBytes),
      url: location.href
    });

    if (!saveRes || !saveRes.ok) {
      throw new DOMException(saveRes?.error || "Failed to save passkey in AccountVault", "UnknownError");
    }

    const toBuf = (u8) => u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
    const clientExtResults = {};
    if (pk.extensions && pk.extensions.credProps) {
      clientExtResults.credProps = { rk: true };
    }

    const response = makeAttestationResponseObj({
      clientDataJSON: toBuf(clientDataBytes),
      attestationObject: toBuf(attestationObject),
      authDataBuf: toBuf(authData),
      spkiBuf: toBuf(spkiBytes),
      alg: chosenAlg,
      transports
    });

    const credObj = makeCredentialResponseObj(credIdBytes, response, clientExtResults, attachment);
    Object.defineProperty(credObj, "toJSON", {
      value: () => ({
        id: credObj.id,
        rawId: credObj.id,
        type: "public-key",
        authenticatorAttachment: attachment,
        clientExtensionResults: clientExtResults,
        response: {
          clientDataJSON: b64urlEncode(clientDataBytes),
          attestationObject: b64urlEncode(attestationObject),
          transports
        }
      }),
      enumerable: true
    });
    return credObj;
  };

  navigator.credentials.get = async function (options) {
    if (!options || !options.publicKey) {
      return origGet(options);
    }
    const pk = options.publicKey;
    const rpId = pk.rpId || location.hostname;
    const allowIds = (pk.allowCredentials || []).map((c) => b64urlEncode(toUint8(c.id)));

    const pickRes = await askContent("GET_PASSKEY", {
      rpId,
      allowIds
    });

    if (!pickRes || pickRes.fallback || !pickRes.passkey) {
      return origGet(options);
    }

    const chosen = pickRes.passkey;
    const credIdBytes = b64urlDecode(chosen.credential_id);
    const jwk = JSON.parse(chosen.private_key_jwk);
    const isRsa = jwk.kty === "RSA" || jwk.alg === "RS256";
    const privKey = await crypto.subtle.importKey(
      "jwk",
      jwk,
      isRsa ? { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" } : { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["sign"]
    );

    const clientDataStr = JSON.stringify({
      type: "webauthn.get",
      challenge: b64urlEncode(toUint8(pk.challenge)),
      origin: location.origin,
      crossOrigin: detectCrossOrigin()
    });
    const clientDataBytes = new TextEncoder().encode(clientDataStr);
    const clientDataHash = await sha256(clientDataBytes);

    const nextCount = (chosen.sign_count || 0) + 1;
    const rpIdHash = await sha256(new TextEncoder().encode(chosen.rp_id || rpId));
    // UP (0x01) + UV (0x04) + BE (0x08) + BS (0x10) = 0x1d
    const flags = new Uint8Array([0x1d]);
    const signCount = new Uint8Array([
      (nextCount >>> 24) & 0xff,
      (nextCount >>> 16) & 0xff,
      (nextCount >>> 8) & 0xff,
      nextCount & 0xff
    ]);
    const authData = concatBytes(rpIdHash, flags, signCount);
    const signedData = concatBytes(authData, clientDataHash);

    const rawSig = new Uint8Array(
      await crypto.subtle.sign(
        isRsa ? { name: "RSASSA-PKCS1-v1_5" } : { name: "ECDSA", hash: "SHA-256" },
        privKey,
        signedData
      )
    );
    const finalSig = isRsa ? rawSig : p1363ToDer(rawSig);

    askContent("BUMP_PASSKEY", {
      credentialId: chosen.credential_id,
      signCount: nextCount
    });

    const userHandleBytes = chosen.user_id ? b64urlDecode(chosen.user_id) : new Uint8Array(0);
    const toBuf = (u8) => u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);

    const response = makeAssertionResponseObj({
      clientDataJSON: toBuf(clientDataBytes),
      authenticatorData: toBuf(authData),
      signature: toBuf(finalSig),
      userHandle: userHandleBytes.length > 0 ? toBuf(userHandleBytes) : null
    });

    const credObj = makeCredentialResponseObj(credIdBytes, response, {});
    Object.defineProperty(credObj, "toJSON", {
      value: () => ({
        id: credObj.id,
        rawId: credObj.id,
        type: "public-key",
        authenticatorAttachment: "platform",
        clientExtensionResults: {},
        response: {
          clientDataJSON: b64urlEncode(clientDataBytes),
          authenticatorData: b64urlEncode(authData),
          signature: b64urlEncode(finalSig),
          userHandle: userHandleBytes.length > 0 ? b64urlEncode(userHandleBytes) : undefined
        }
      }),
      enumerable: true
    });
    return credObj;
  };
})();
