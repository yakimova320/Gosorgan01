import { Inject } from '@nestjs/common';
import {
  Body,
  Controller,
  Get,
  Param,
  ParseFilePipe,
  Post,
  UploadedFile,
  UseInterceptors,
  UnprocessableEntityException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Upload } from '../documents/types.js';
import { z } from 'zod';
import { CasesService } from '../cases/cases.service.js';
import { TraceService } from '../llm/trace.service.js';
import { CaseWorkflowService } from './case-workflow.service.js';
const CreateCase = z
  .object({ title: z.string().trim().min(1).max(200) })
  .strict();
const Message = z
  .object({ text: z.string().trim().min(1).max(10000) })
  .strict();
const Id = z.string().regex(/^[a-z0-9]{20,40}$/);
function id(value: string) {
  const r = Id.safeParse(value);
  if (!r.success)
    throw new UnprocessableEntityException('Некорректный идентификатор');
  return r.data;
}
function parse<T>(schema: z.ZodType<T>, value: unknown) {
  const r = schema.safeParse(value);
  if (!r.success)
    throw new UnprocessableEntityException({
      code: 'INVALID_REQUEST',
      message: 'Проверьте поля запроса',
      details: r.error.issues,
    });
  return r.data;
}
@ApiTags('cases')
@ApiResponse({
  status: 422,
  description:
    'Invalid body, file, or draft verification; {code,message,details?}',
})
@ApiResponse({
  status: 502,
  description: 'LLM failed; case state unchanged, failed attempts traced',
})
@Controller('cases')
export class CasesController {
  constructor(
    @Inject(CasesService) private readonly cases: CasesService,
    @Inject(CaseWorkflowService) private readonly workflow: CaseWorkflowService,
    @Inject(TraceService) private readonly traces: TraceService,
  ) {}
  @Post()
  @ApiOperation({ summary: 'Создать дело' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['title'],
      properties: { title: { type: 'string', maxLength: 200 } },
    },
  })
  @ApiResponse({
    status: 201,
    description: 'Created case with id, title, status',
  })
  create(@Body() body: unknown) {
    return this.cases.create(parse(CreateCase, body).title);
  }
  @Get(':id')
  @ApiOperation({
    summary: 'Состояние дела, история, подтверждения, сроки и вопросы',
  })
  @ApiParam({ name: 'id' })
  @ApiResponse({
    status: 200,
    description:
      'Case state including claims, letters, drafts, timeline, nearestDeadline and openQuestions',
  })
  get(@Param('id') value: string) {
    return this.cases.state(id(value));
  }
  @Post(':id/letters')
  @ApiOperation({
    summary: 'Загрузить письмо PDF, JPG или PNG (10 МБ; до 20 страниц)',
  })
  @ApiParam({ name: 'id' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @ApiResponse({
    status: 201,
    description:
      'Letter, extracted fields and pending linkSuggestions; claims require human review',
  })
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 10 * 1024 * 1024, files: 1 },
      fileFilter: (_req, file, cb) => {
        if (
          !['application/pdf', 'image/jpeg', 'image/png'].includes(
            file.mimetype,
          )
        )
          return cb(
            new UnprocessableEntityException('Поддерживаются PDF, JPG и PNG'),
            false,
          );
        cb(null, true);
      },
    }),
  )
  ingest(
    @Param('id') value: string,
    @UploadedFile(
      new ParseFilePipe({ fileIsRequired: true, errorHttpStatusCode: 422 }),
    )
    file: Upload,
  ) {
    return this.workflow.ingestLetter(id(value), file);
  }
  @Post(':id/messages')
  @ApiOperation({
    summary: 'Сохранить слова пользователя как USER / UNCONFIRMED',
  })
  @ApiParam({ name: 'id' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['text'],
      properties: { text: { type: 'string', maxLength: 10000 } },
    },
  })
  @ApiResponse({
    status: 201,
    description: 'At most three questions and updated state',
  })
  message(@Param('id') value: string, @Body() body: unknown) {
    return this.workflow.handleMessage(id(value), parse(Message, body).text);
  }
  @Post(':id/links/:linkId/confirm')
  @ApiOperation({ summary: 'Подтвердить перенос письма в предложенное дело' })
  @ApiParam({ name: 'id' })
  @ApiParam({ name: 'linkId' })
  @ApiResponse({
    status: 201,
    description: 'Updated target case state; competing suggestions rejected',
  })
  link(@Param('id') value: string, @Param('linkId') linkId: string) {
    return this.workflow.confirmLink(id(value), id(linkId));
  }
  @Post(':id/claims/:claimId/confirm')
  @ApiOperation({
    summary: 'Человек проверил цитату: подтвердить документальное утверждение',
  })
  @ApiParam({ name: 'id' })
  @ApiParam({ name: 'claimId' })
  @ApiResponse({
    status: 201,
    description: 'Updated state; USER claims cannot be manually promoted',
  })
  claim(@Param('id') value: string, @Param('claimId') claimId: string) {
    return this.workflow.confirmClaim(id(value), id(claimId));
  }
  @Post(':id/draft')
  @ApiOperation({
    summary: 'Подготовить проверенный черновик из подтверждённых фактов',
  })
  @ApiParam({ name: 'id' })
  @ApiResponse({
    status: 201,
    description: 'PREPARED draft and verification report with source checklist',
  })
  @ApiResponse({
    status: 409,
    description: 'No confirmed claims, or conflicting case numbers',
  })
  draft(@Param('id') value: string) {
    return this.workflow.prepareDraft(id(value));
  }
  @Get(':id/trace')
  @ApiOperation({ summary: 'Трасса вызовов ИИ, включая неудачные попытки' })
  @ApiParam({ name: 'id' })
  @ApiResponse({
    status: 200,
    description:
      'LLM calls with prompt version, provider, input, output, duration, tokens and errors',
  })
  trace(@Param('id') value: string) {
    return this.traces.list(id(value));
  }
}
