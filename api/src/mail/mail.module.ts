import { Inject, Module, type OnModuleInit } from '@nestjs/common';
import { StorageService } from '../documents/storage.service.js';
import { AccountErasureService } from '../erasure/account-erasure.service.js';
import { ErasureModule } from '../erasure/erasure.module.js';
import { LettersModule } from '../letters/letters.module.js';
import { MailTransport } from './mail-transport.js';
import { ResetMailOutbox } from './reset-mail.outbox.js';

/** Очистка писем кабинета на последнем этапе удаления аккаунта (A01). Нужна и скрипту db:wipe-accounts. */
export function registerResetMailCleaner(
  erasure: AccountErasureService,
  storage: StorageService,
): void {
  erasure.registerCleaner({
    name: 'reset-mail',
    clean: (cabinetId) => storage.removeMailDir(cabinetId),
  });
}

/*
 * A03: письма восстановления пароля. Удаление аккаунта (A01) на последнем этапе удаляет
 * папку писем кабинета; задания удаляются каскадом вместе с кабинетом.
 */
@Module({
  imports: [LettersModule, ErasureModule],
  providers: [MailTransport, ResetMailOutbox],
  exports: [ResetMailOutbox],
})
export class MailModule implements OnModuleInit {
  constructor(
    @Inject(AccountErasureService) private readonly erasure: AccountErasureService,
    @Inject(StorageService) private readonly storage: StorageService,
  ) {}

  onModuleInit(): void {
    registerResetMailCleaner(this.erasure, this.storage);
  }
}
