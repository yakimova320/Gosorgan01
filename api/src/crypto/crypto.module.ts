import { Global, Module } from '@nestjs/common';
import { StorageService } from '../documents/storage.service.js';
import { CryptoController } from './crypto.controller.js';
import { LegacyEncryptionService } from './legacy-encryption.service.js';
import { VaultService } from './vault.service.js';

/** E01 (#163): ключ архива, ключи документов, шифрование полей. VaultService доступен всем модулям. */
@Global()
@Module({
  controllers: [CryptoController],
  providers: [VaultService, LegacyEncryptionService, StorageService],
  exports: [VaultService],
})
export class CryptoModule {}
