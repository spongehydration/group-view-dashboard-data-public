import { toast } from "sonner";

export interface GroupData {
  [custId: string]: {
    [date: string]: [string, number][];
  };
}

// Interfaces for other data types remain the same
export interface NursesData { /* ... */ }
export interface RoomsData { /* ... */ }

export class AwsApiService {
  private baseUrl: string;
  private userId: string | null = null;

  constructor(userId: string | null = null) {
    this.baseUrl =
      "https://ajtwnkl2yb.execute-api.us-east-2.amazonaws.com/test/sponge";
    this.userId = userId;
  }

  setUserId(userId: string | null) {
    this.userId = userId;
  }

  // -------------------------------
  // 🧩 BATCH DECRYPT HELPER (New)
  // -------------------------------
  /**
   * Makes a single POST request to the server function to decrypt an array of values.
   */
  private async decryptBatchServerSide(encryptedValues: string[]): Promise<(string | null)[]> {
    if (encryptedValues.length === 0) return [];

    try {
      // 💡 ONE SINGLE NETWORK REQUEST for all decryption
      const res = await fetch("/decrypt-group-data", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: encryptedValues }),
      });

      if (!res.ok) {
        const errorText = await res.text();
        console.error("Server batch decryption failed:", res.status, errorText);
        throw new Error(`Batch Decryption failed with status ${res.status}`);
      }

      const json = await res.json();

      if (!json || !json.success || !Array.isArray(json.decrypted)) {
        console.error("Batch decryption returned invalid structure:", json);
        throw new Error(json?.error || "Server decryption failed");
      }

      // The server returns an array of decrypted strings or null for failed items
      return json.decrypted as (string | null)[];
    } catch (err) {
      console.error("Batch decryption request failed:", err);
      // Return nulls for all values if the entire batch request fails
      return encryptedValues.map(() => null); 
    }
  }

  // -------------------------------
  // Group data with server decryption (Rewritten for Batching)
  // -------------------------------
  async getGroupData(groupName: string): Promise<GroupData> {
    console.log("--- DEBUG: 1. getGroupData STARTED ---");
    console.log("Group Name:", groupName);
    try {
      const params = { Type: "getgroupdata", GroupName: groupName };
      console.log("--- DEBUG: 2. Calling makeRequest to AWS API ---");
      const encryptedGroupData = await this.makeRequest<GroupData>(params);
      console.log("Encrypted Group Data [Step 1]:", encryptedGroupData);
      console.log("--- DEBUG: 3. makeRequest SUCCEEDED ---");
      // suck my balls queer

      // --- BATCHING SETUP ---
      const batchMap = new Map<number, { path: string[], originalValue: string }>();
      const batchValues: string[] = [];
      const plainDataMap: { [key: string]: [string, number] } = {};
      let index = 0;

      // 1. ITERATE AND COLLECT ALL ENCRYPTED VALUES
      for (const custId in encryptedGroupData) {
        for (const date in encryptedGroupData[custId]) {
          const entries = encryptedGroupData[custId][date];

          entries.forEach(([id, val]) => {
            
            // CRITICAL CHECK: Handle null or undefined values
            if (val === null || val === undefined) {
                // Store non-encrypted/null data path and value (default 0)
                plainDataMap[`${custId}_${date}_${id}`] = [id, 0];
                return;
            }
            
            const stringVal = val.toString();

            // CHECK: If it doesn't look encrypted (no '^'), treat as a plain number
            if (typeof val === "number" || !stringVal.includes('^')) {
                const num = parseFloat(stringVal);
                plainDataMap[`${custId}_${date}_${id}`] = [id, isNaN(num) ? 0 : num];
            } else {
                // Collect encrypted value and its original location path
                batchMap.set(index, { path: [custId, date, id], originalValue: stringVal });
                batchValues.push(stringVal);
                index++;
            }
          });
        }
      }

      // 2. RUN BATCH DECRYPTION (ONE REQUEST)
      const decryptedResults = await this.decryptBatchServerSide(batchValues);
      console.log("Decrypted Results [Step 2]:", decryptedResults);

      // 3. RECONSTRUCT THE FINAL DATA STRUCTURE
      const finalGroupData: GroupData = {};
      let decryptedIndex = 0;

      for (const custId in encryptedGroupData) {
        finalGroupData[custId] = {};
        for (const date in encryptedGroupData[custId]) {
          finalGroupData[custId][date] = encryptedGroupData[custId][date].map(
            ([id, val]) => {
              const key = `${custId}_${date}_${id}`;

              // Check if it was plain data
              if (plainDataMap.hasOwnProperty(key)) {
                return plainDataMap[key];
              }

              // It was an encrypted value, retrieve the batched result
              const decryptedVal = decryptedResults[decryptedIndex];
              decryptedIndex++;

              if (decryptedVal === null) {
                  // Decryption failed for this specific item
                  console.warn(`Decryption failed for item ID: ${id}. Setting to 0.`);
                  return [id, 0];
              }
              
              // Convert the successfully decrypted string to a number
              const num = parseFloat(decryptedVal);
              return [id, isNaN(num) ? 0 : num];
            }
          );
        }
      }
      console.log("Final Data [Step Final]:", finalGroupData);
      return finalGroupData;
    } catch (error) {
      console.error("--- DEBUG: getGroupData CRASHED ---", error);
      console.error("Failed to get group data:", error);
      toast.error("Failed to get group data");
      return {};
    }
  }

  // -------------------------------
  // Other endpoints (remains the same)
  // -------------------------------
  public async makeRequest<T>(params: Record<string, string>): Promise<T> {
    try {
      const queryParams = new URLSearchParams(params).toString();
      const url = `${this.baseUrl}?${queryParams}`;

      // This is the call that initiates the request to your AWS endpoint
      const response = await fetch(url);

      if (!response.ok) {
        // Log the failure to the console
        const errorText = await response.text();
        console.error(`AWS API request failed: ${response.status} - ${errorText}`);
        throw new Error(`API request failed with status ${response.status}`);
      }

      // Return the JSON response body
      return response.json() as Promise<T>;
    } catch (error) {
      console.error("API request failed:", error);
      toast.error("Failed to fetch data from API");
      throw error;
    }
  }
  async getUserGroup(): Promise<string> {
    if (!this.userId) {
      toast.error("User ID not set");
      return "";
    }

    try {
      const params = { Type: 'getusergroup', CustID: this.userId };
      const response = await this.makeRequest<{ Groups: string[] }>(params);
      return response.Groups[0] || "";
    } catch (error) {
      console.error("Failed to get user group:", error);
      return "";
    }
  }
  async getNurses(groupName: string): Promise<NursesData> {
    try {
      const params = { Type: 'getNurseByGroup', GroupName: groupName };
      return await this.makeRequest<NursesData>(params);
    } catch (error) {
      console.error("Failed to get nurses:", error);
      return {};
    }
  }
  async getRooms(groupName: string): Promise<RoomsData> {
    try {
      const params = { Type: 'getRoomByGroup', GroupName: groupName };
      return await this.makeRequest<RoomsData>(params);
    } catch (error) {
      console.error("Failed to get rooms:", error);
      return {};
    }
  }
  async getNames(groupName: string): Promise<Record<string, string>> {
    try {
      const params = { Type: 'getNamesByGroup', GroupName: groupName };
      return await this.makeRequest<Record<string, string>>(params);
    } catch (error) {
      console.error("Failed to get names:", error);
      return {};
    }
  }
  async newCustID(): Promise<string> {
    try {
      const params = { Type: 'newcustid' };
      return await this.makeRequest<string>(params);
    } catch (error) {
      console.error("Failed to get new customer ID:", error);
      throw error;
    }
  }
  async createUser(params: Record<string, string>): Promise<any> {
    try {
      return await this.makeRequest(params);
    } catch (error) {
      console.error("Failed to create user:", error);
      throw error;
    }
  }
  async updateNurse(params: Record<string, string>): Promise<any> {
    try {
      return await this.makeRequest(params);
    } catch (error) {
      console.error("Failed to update nurse:", error);
      throw error;
    }
  }
  async updateUserNurse(params: Record<string, string>): Promise<any> {
    try {
      return await this.makeRequest(params);
    } catch (error) {
      console.error("Failed to update user nurse:", error);
      throw error;
    }
  } 
}

// ✅ Initialize API service
export const awsApi = new AwsApiService("rn0Np34StiZ92U0ywZW96MVXBDx1");