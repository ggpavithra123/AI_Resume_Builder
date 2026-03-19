"use client";

import { toast } from "@/hooks/use-toast";
import { api } from "@/lib/hono-rpc";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { DocumentCreateRequest, DocumentCreateResponse } from "@/types/api";

const useCreateDocument = () => {
  const queryClient = useQueryClient();

  return useMutation<DocumentCreateResponse, Error, DocumentCreateRequest>({
    mutationFn: async (json) => {
      // api.document.create.$post is already typed
      return api.document.create.$post({ json });
    },
    onSuccess: (response) => {
      console.log("Document created:", response);
      queryClient.invalidateQueries({ queryKey: ["documents"] });
      toast({
        title: "Success",
        description: `Document "${response.title}" created successfully`,
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to create document",
        variant: "destructive",
      });
    },
  });
};

export default useCreateDocument;