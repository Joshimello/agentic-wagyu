import { z } from 'zod';
import { id } from '../../../../../../lib/server/contracts';
import {
  cancelTranslation,
  TranslationRequestError,
} from '../../../../../../lib/server/services/translations';

export async function POST({
  params,
  request,
}: {
  params: { id: string };
  request: Request;
}) {
  try {
    const { translationId } = z
      .object({ translationId: id })
      .strict()
      .parse(await request.json());
    return Response.json(await cancelTranslation(params.id, translationId));
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Cancellation failed' },
      {
        status:
          error instanceof TranslationRequestError
            ? error.status
            : error instanceof z.ZodError || error instanceof SyntaxError
              ? 400
              : 500,
      },
    );
  }
}
