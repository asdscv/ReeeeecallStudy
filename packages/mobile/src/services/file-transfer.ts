import * as DocumentPicker from 'expo-document-picker'
import * as FileSystem from 'expo-file-system/legacy'
import * as Sharing from 'expo-sharing'

/**
 * File transfer service — abstracts native file I/O for import/export.
 * Enterprise pattern: isolate platform-specific file APIs behind service layer.
 */
class FileTransferService {
  /**
   * Pick a file from device storage.
   */
  async pickFile(type: string = '*/*'): Promise<{ content: string; name: string } | null> {
    try {
      const result = await DocumentPicker.getDocumentAsync({ type, copyToCacheDirectory: true })

      if (result.canceled || !result.assets?.[0]) return null

      const asset = result.assets[0]
      const content = await FileSystem.readAsStringAsync(asset.uri)
      return { content, name: asset.name }
    } catch {
      return null
    }
  }

  /**
   * Pick a CSV file specifically.
   */
  async pickCSV(): Promise<{ content: string; name: string } | null> {
    return this.pickFile('text/csv')
  }

  /**
   * Pick a JSON file specifically.
   */
  async pickJSON(): Promise<{ content: string; name: string } | null> {
    return this.pickFile('application/json')
  }

  /**
   * Export content as a file and open native share sheet.
   */
  async shareFile(filename: string, content: string, mimeType: string = 'text/plain'): Promise<boolean> {
    try {
      const filePath = `${FileSystem.documentDirectory}${filename}`
      await FileSystem.writeAsStringAsync(filePath, content)

      const isAvailable = await Sharing.isAvailableAsync()
      if (!isAvailable) return false

      await Sharing.shareAsync(filePath, { mimeType, dialogTitle: `Export ${filename}` })
      return true
    } catch {
      return false
    }
  }

  /**
   * Export as CSV.
   */
  async shareCSV(filename: string, csvContent: string): Promise<boolean> {
    return this.shareFile(filename, csvContent, 'text/csv')
  }

  /**
   * Export as JSON.
   */
  async shareJSON(filename: string, jsonContent: string): Promise<boolean> {
    return this.shareFile(filename, jsonContent, 'application/json')
  }
}

export const fileTransferService = new FileTransferService()
