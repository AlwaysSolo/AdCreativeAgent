import { handleOpenFolderRequest } from "../../../src/lib/open-folder-handler";

export async function POST(request: Request) {
  return handleOpenFolderRequest(request);
}
