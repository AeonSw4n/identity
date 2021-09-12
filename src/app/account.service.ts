import {Injectable} from '@angular/core';
import {CryptoService} from './crypto.service';
import {GlobalVarsService} from './global-vars.service';
import {AccessLevel, DerivedUserInfo, Network, PrivateUserInfo, PublicUserInfo} from '../types/identity';
import {CookieService} from 'ngx-cookie';
import {EntropyService} from './entropy.service';
import {SigningService} from './signing.service';
import sha256 from 'sha256';
import {ec as EC} from 'elliptic';
import {uint64ToBufBigEndian, uvarint64ToBuf} from '../lib/bindata/util';

@Injectable({
  providedIn: 'root'
})
export class AccountService {
  private static usersStorageKey = 'users';
  private static levelsStorageKey = 'levels';

  private static publicKeyRegex = /^[a-zA-Z0-9]{54,55}$/;

  constructor(
    private cryptoService: CryptoService,
    private globalVars: GlobalVarsService,
    private cookieService: CookieService,
    private entropyService: EntropyService,
    private signingService: SigningService
  ) { }

  // Getters

  getPublicKeys(): any {
    return Object.keys(this.getPrivateUsers());
  }

  getEncryptedUsers(): {[key: string]: PublicUserInfo} {
    const hostname = this.globalVars.hostname;
    const privateUsers = this.getPrivateUsers();
    const publicUsers: {[key: string]: PublicUserInfo} = {};

    for (const publicKey of Object.keys(privateUsers)) {
      const privateUser = privateUsers[publicKey];
      const accessLevel = this.getAccessLevel(publicKey, hostname);
      if (accessLevel === AccessLevel.None) {
        continue;
      }

      const encryptedSeedHex = this.cryptoService.encryptSeedHex(privateUser.seedHex, hostname);
      const accessLevelHmac = this.cryptoService.accessLevelHmac(accessLevel, privateUser.seedHex);

      publicUsers[publicKey] = {
        hasExtraText: privateUser.extraText?.length > 0,
        btcDepositAddress: privateUser.btcDepositAddress,
        encryptedSeedHex,
        network: privateUser.network,
        accessLevel,
        accessLevelHmac,
      };
    }

    return publicUsers;
  }

  getAccessLevel(publicKey: string, hostname: string): AccessLevel {
    if (GlobalVarsService.noAccessHostnames.includes(hostname)) {
      return AccessLevel.None;
    }

    const levels = JSON.parse(localStorage.getItem(AccountService.levelsStorageKey) || '{}');
    const hostMapping = levels[hostname] || {};
    const accessLevel = hostMapping[publicKey];

    if (Object.values(AccessLevel).includes(accessLevel)) {
      return accessLevel;
    } else if (GlobalVarsService.fullAccessHostnames.includes(hostname)) {
      return AccessLevel.Full;
    } else {
      return AccessLevel.None;
    }
  }

  getDerivedUser(publicKey: string, blockHeight: number): DerivedUserInfo{
    const privateUser = this.getPrivateUsers()[publicKey];


    this.entropyService.setNewTemporaryEntropy();
    const derivedMnemonic = this.entropyService.temporaryEntropy?.mnemonic;
    const derivedKeychain = this.cryptoService.mnemonicToKeychain(derivedMnemonic);
    const derivedSeedHex = this.cryptoService.keychainToSeedHex(derivedKeychain);
    const derivedPrivateKey = this.cryptoService.seedHexToPrivateKey(derivedSeedHex);
    const derivedPublicKey = this.cryptoService.privateKeyToBitcloutPublicKey(derivedPrivateKey, privateUser.network);

    // By default we authorize this derived key for 10,000 blocks.
    const expirationBlock = blockHeight + 10000;

    const expirationBlockBuffer = uint64ToBufBigEndian(expirationBlock);
    const derivedPublicKeyBuffer = derivedPrivateKey.getPublic().encode('array', true);
    const accessHash = sha256.x2([...derivedPublicKeyBuffer, ...expirationBlockBuffer]);
    const accessSignature = this.signingService.signBurn(privateUser.seedHex, [accessHash])[0];

    return {
      btcDepositAddress: privateUser.btcDepositAddress,
      derivedPublicKey,
      derivedSeedHex,
      expirationBlock,
      accessSignature,
      network: privateUser.network,
      publicKey
    };
  }

  // Modifiers

  addUser(userInfo: PrivateUserInfo): string {
    const privateUsers = this.getPrivateUsersRaw();
    const privateKey = this.cryptoService.seedHexToPrivateKey(userInfo.seedHex);
    const publicKey = this.cryptoService.privateKeyToBitcloutPublicKey(privateKey, userInfo.network);

    privateUsers[publicKey] = userInfo;

    localStorage.setItem(AccountService.usersStorageKey, JSON.stringify(privateUsers));

    return publicKey;
  }

  deleteUser(publicKey: string): void {
    const privateUsers = this.getPrivateUsersRaw();

    delete privateUsers[publicKey];

    localStorage.setItem(AccountService.usersStorageKey, JSON.stringify(privateUsers));
  }

  setAccessLevel(publicKey: string, hostname: string, accessLevel: AccessLevel): void {
    const levels = JSON.parse(localStorage.getItem(AccountService.levelsStorageKey) || '{}');

    levels[hostname] ||= {};
    levels[hostname][publicKey] = accessLevel;

    localStorage.setItem(AccountService.levelsStorageKey, JSON.stringify(levels));
  }

  // Private / Sensitive

  private getPrivateUsers(): {[key: string]: PrivateUserInfo} {
    const privateUsers = this.getPrivateUsersRaw();
    const filteredPrivateUsers: {[key: string]: PrivateUserInfo} = {};

    for (const publicKey of Object.keys(privateUsers)) {
      const privateUser = privateUsers[publicKey];

      // Only include users from the current network
      if (privateUser.network !== this.globalVars.network) {
        continue;
      }

      // Get rid of some users who have invalid public keys
      if (!publicKey.match(AccountService.publicKeyRegex)) {
        this.deleteUser(publicKey);
        continue;
      }

      filteredPrivateUsers[publicKey] = privateUser;
    }

    return filteredPrivateUsers;
  }

  private getPrivateUsersRaw(): {[key: string]: PrivateUserInfo} {
    return JSON.parse(localStorage.getItem(AccountService.usersStorageKey) || '{}');
  }
}
