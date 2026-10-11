import { z } from 'zod';
import {
  getTranslation,
  requestTranslation,
  TranslationRequestError,
} from '../../../../../lib/server/services/translations';

function failure(error: unknown) {
  const status =
    error instanceof TranslationRequestError
      ? error.status
      : error instanceof z.ZodError || error instanceof SyntaxError
        ? 400
        : 500;
  return Response.json(
    {
      error:
        status === 400
          ? 'Choose a valid revision and either English or Traditional Chinese'
          : error instanceof TranslationRequestError
            ? error.message
            : 'Translation is unavailable. Try again in a moment.',
    },
    { status },
  );
}

export async function GET({
  params,
  url,
}: {
  params: { id: string };
  url: URL;
}) {
  try {
    return Response.json(
      await getTranslation(params.id, {
        revisionId: url.searchParams.get('revisionId'),
        language: url.searchParams.get('language'),
      }),
    );
  } catch (error) {
    return failure(error);
  }
}

export async function POST({
  params,
  request,
}: {
  params: { id: string };
  request: Request;
}) {
  try {
    const result = await requestTranslation(params.id, await request.json());
    return Response.json(result, {
      status: result.state === 'ready' ? 200 : 202,
    });
  } catch (error) {
    return failure(error);
  }
}
