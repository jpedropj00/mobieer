import { isRouteErrorResponse, useRouteError } from "react-router-dom";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { errorMessage, isChunkLoadError } from "@/lib/errors";

/**
 * Tela de erro das rotas. Sem ela, qualquer exceção de renderização mostra a
 * página padrão do React Router ("Unexpected Application Error!").
 *
 * Caso especial: depois de um deploy novo, abas abertas pedem arquivos do build
 * antigo que não existem mais — aí basta recarregar.
 */
export function RouteError() {
  const error = useRouteError();

  const notFound = isRouteErrorResponse(error) && error.status === 404;
  const outdated = isChunkLoadError(error);

  if (!notFound && !outdated) console.error("[RouteError]", error);

  const title = notFound ? "Página não encontrada" : outdated ? "O sistema foi atualizado" : "Algo deu errado nesta tela";
  const description = notFound
    ? "O endereço acessado não existe."
    : outdated
      ? "Uma nova versão foi publicada. Recarregue a página para continuar."
      : errorMessage(error, "Ocorreu um erro inesperado. Tente recarregar a página; se continuar, avise o suporte.");

  return (
    <div className="flex min-h-[60vh] items-center justify-center p-6">
      <div className="max-w-md space-y-4 text-center">
        <AlertTriangle className="mx-auto h-10 w-10 text-warning" />
        <h1 className="text-lg font-semibold">{title}</h1>
        <p className="text-sm text-muted-foreground">{description}</p>
        <div className="flex justify-center gap-2">
          <Button variant="outline" onClick={() => window.history.back()}>
            Voltar
          </Button>
          <Button onClick={() => window.location.reload()}>
            <RefreshCw className="mr-2 h-4 w-4" /> Recarregar
          </Button>
        </div>
      </div>
    </div>
  );
}
